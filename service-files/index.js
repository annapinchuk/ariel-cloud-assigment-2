const express = require('express');
const RestaurantsMemcachedActions = require('./model/restaurantsMemcachedActions');
const AWS = require('aws-sdk');

const app = express();
app.use(express.json());

const {
    MEMCACHED_CONFIGURATION_ENDPOINT,
    TABLE_NAME,
    AWS_REGION,
    USE_CACHE
} = process.env;

const memcachedActions = new RestaurantsMemcachedActions(MEMCACHED_CONFIGURATION_ENDPOINT);
const dynamodb = new AWS.DynamoDB.DocumentClient({ region: AWS_REGION });

app.get('/', (req, res) => {
    res.send({
        MEMCACHED_CONFIGURATION_ENDPOINT,
        TABLE_NAME,
        AWS_REGION,
        USE_CACHE: USE_CACHE === 'true'
    });
});

const getRestaurant = async (name) => {
    const params = {
        TableName: TABLE_NAME,
        Key: { SimpleKey: name }
    };
    return dynamodb.get(params).promise();
};

const addRestaurant = async (restaurant) => {
    const params = {
        TableName: TABLE_NAME,
        Item: {
            SimpleKey: restaurant.name,
            Cuisine: restaurant.cuisine,
            GeoRegion: restaurant.region,
            Rating: restaurant.rating || 0,
            RatingCount: 0
        }
    };
    return dynamodb.put(params).promise();
};

const invalidateCacheKeys = async (restaurant) => {
    const cacheKeysToInvalidate = [];

    for (let limit = 10; limit <= 100; limit += 1) {
        cacheKeysToInvalidate.push(`${restaurant.region}_limit_${limit}`);
        cacheKeysToInvalidate.push(`${restaurant.region}_${restaurant.cuisine}_limit_${limit}`);

        for (let minRating = 0; minRating <= 5; minRating += 0.1) {
            cacheKeysToInvalidate.push(`${restaurant.cuisine}_minRating_${minRating}_limit_${limit}`);
        }
    }

    const deletePromises = cacheKeysToInvalidate.map(key => 
        memcachedActions.deleteRestaurants(key).catch(err => {
            if (!(err.cmdTokens && err.cmdTokens[0] === 'NOT_FOUND')) throw err;
        })
    );

    return Promise.all(deletePromises);
};

app.post('/restaurants', async (req, res) => {
    const restaurant = req.body;

    if (!restaurant.name || !restaurant.cuisine || !restaurant.region) {
        return res.status(400).send({ success: false, message: 'Missing required fields' });
    }

    try {
        if (USE_CACHE === 'true') {
            const cachedRestaurant = await memcachedActions.getRestaurants(restaurant.name);
            if (cachedRestaurant) {
                return res.status(409).send({ success: false, message: 'Restaurant already exists' });
            }
        } else {
            const data = await getRestaurant(restaurant.name);
            if (data.Item) {
                return res.status(409).send({ success: false, message: 'Restaurant already exists' });
            }
        }

        await addRestaurant(restaurant);

        if (USE_CACHE === 'true') {
            await invalidateCacheKeys(restaurant);
            await memcachedActions.addRestaurants(restaurant.name, restaurant);
        }

        res.status(200).send({ success: true });
    } catch (err) {
        console.error('POST /restaurants', err);
        res.status(500).send("Internal Server Error");
    }
});

app.get('/restaurants/:restaurantName', async (req, res) => {
    const { restaurantName } = req.params;

    try {
        if (USE_CACHE === 'true') {
            const cachedRestaurant = await memcachedActions.getRestaurants(restaurantName);
            if (cachedRestaurant) {
                cachedRestaurant.rating = parseFloat(cachedRestaurant.rating) || 0;
                return res.status(200).send(cachedRestaurant);
            }
        }

        const data = await getRestaurant(restaurantName);
        if (!data.Item) {
            return res.status(404).send({ message: 'Restaurant not found' });
        }

        const restaurant = {
            name: data.Item.SimpleKey,
            cuisine: data.Item.Cuisine,
            rating: data.Item.Rating || 0,
            region: data.Item.GeoRegion
        };

        if (USE_CACHE === 'true') {
            restaurant.rating = restaurant.rating.toString();
            await memcachedActions.addRestaurants(restaurantName, restaurant);
        }

        res.status(200).send(restaurant);
    } catch (err) {
        console.error('GET /restaurants/:restaurantName', err);
        res.status(500).send('Internal Server Error');
    }
});

app.delete('/restaurants/:restaurantName', async (req, res) => {
    const { restaurantName } = req.params;

    try {
        const data = await getRestaurant(restaurantName);
        if (!data.Item) {
            return res.status(404).send({ message: 'Restaurant not found' });
        }

        if (USE_CACHE === 'true') {
            await memcachedActions.deleteRestaurants(restaurantName);
            await invalidateCacheKeys(data.Item);
        }

        await dynamodb.delete({ TableName: TABLE_NAME, Key: { SimpleKey: restaurantName } }).promise();
        res.status(200).send({ success: true });
    } catch (err) {
        console.error('DELETE /restaurants/:restaurantName', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/restaurants/rating', async (req, res) => {
    const { name: restaurantName, rating: newRating } = req.body;

    if (!restaurantName || !newRating) {
        return res.status(400).send({ success: false, message: 'Missing required fields' });
    }

    try {
        const data = await getRestaurant(restaurantName);
        if (!data.Item) {
            return res.status(404).send("Restaurant not found");
        }

        const oldRating = data.Item.Rating || 0;
        const ratingCount = data.Item.RatingCount || 0;
        const newAverageRating = ((oldRating * ratingCount) + newRating) / (ratingCount + 1);

        const updateParams = {
            TableName: TABLE_NAME,
            Key: { SimpleKey: restaurantName },
            UpdateExpression: 'set Rating = :r, RatingCount = :rc',
            ExpressionAttributeValues: {
                ':r': newAverageRating,
                ':rc': ratingCount + 1
            }
        };

        await dynamodb.update(updateParams).promise();

        if (USE_CACHE === 'true') {
            await memcachedActions.addRestaurants(restaurantName, {
                name: restaurantName,
                cuisine: data.Item.Cuisine,
                rating: newAverageRating.toString(),
                region: data.Item.GeoRegion
            });
            await invalidateCacheKeys(data.Item);
        }

        res.status(200).send({ success: true });
    } catch (error) {
        console.error('POST /restaurants/rating', error);
        res.status(500).send("Internal Server Error");
    }
});

const fetchRestaurantsByIndex = async (params, cacheKey) => {
    const data = await dynamodb.query(params).promise();
    const restaurants = data.Items.map(item => ({
        cuisine: item.Cuisine,
        name: item.SimpleKey,
        rating: parseFloat(item.Rating) || 0,
        region: item.GeoRegion
    }));

    if (USE_CACHE === 'true') {
        await memcachedActions.addRestaurants(cacheKey, restaurants);
    }

    return restaurants;
};

app.get('/restaurants/cuisine/:cuisine', async (req, res) => {
    const { cuisine } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const minRating = parseFloat(req.query.minRating) || 0;

    if (minRating < 0 || minRating > 5) {
        return res.status(400).send({ success: false, message: 'Invalid rating' });
    }

    const cacheKey = `${cuisine}_minRating_${minRating}_limit_${limit}`;

    try {
        if (USE_CACHE === 'true') {
            const cachedRestaurants = await memcachedActions.getRestaurants(cacheKey);
            if (cachedRestaurants) {
                cachedRestaurants.forEach(r => r.rating = parseFloat(r.rating) || 0);
                return res.status(200).json(cachedRestaurants);
            }
        }

        const params = {
            TableName: TABLE_NAME,
            IndexName: 'CuisineIndex',
            KeyConditionExpression: 'Cuisine = :cuisine',
            ExpressionAttributeValues: { ':cuisine': cuisine },
            Limit: limit,
            ScanIndexForward: false
        };

        const restaurants = await fetchRestaurantsByIndex(params, cacheKey);
        res.status(200).json(restaurants);
    } catch (error) {
        console.error('GET /restaurants/cuisine/:cuisine', error);
        res.status(500).send("Internal Server Error");
    }
});

app.get('/restaurants/region/:region', async (req, res) => {
    const { region } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const cacheKey = `${region}_limit_${limit}`;

    try {
        if (USE_CACHE === 'true') {
            const cachedRestaurants = await memcachedActions.getRestaurants(cacheKey);
            if (cachedRestaurants) {
                cachedRestaurants.forEach(r => r.rating = parseFloat(r.rating) || 0);
                return res.status(200).json(cachedRestaurants);
            }
        }

        const params = {
            TableName: TABLE_NAME,
            IndexName: 'Georegionindex',
            KeyConditionExpression: 'GeoRegion = :geoRegion',
            ExpressionAttributeValues: { ':geoRegion': region },
            Limit: limit,
            ScanIndexForward: false
        };

        const restaurants = await fetchRestaurantsByIndex(params, cacheKey);
        res.status(200).json(restaurants);
    } catch (error) {
        console.error('GET /restaurants/region/:region', error);
        res.status(500).send("Internal Server Error");
    }
});

app.get('/restaurants/region/:region/cuisine/:cuisine', async (req, res) => {
    const { region, cuisine } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const cacheKey = `${region}_${cuisine}_limit_${limit}`;

    try {
        if (USE_CACHE === 'true') {
            const cachedRestaurants = await memcachedActions.getRestaurants(cacheKey);
            if (cachedRestaurants) {
                cachedRestaurants.forEach(r => r.rating = parseFloat(r.rating) || 0);
                return res.status(200).json(cachedRestaurants);
            }
        }

        const params = {
            TableName: TABLE_NAME,
            IndexName: 'Georegioncuisineindex',
            KeyConditionExpression: 'GeoRegion = :geoRegion and Cuisine = :cuisine',
            ExpressionAttributeValues: {
                ':geoRegion': region,
                ':cuisine': cuisine
            },
            Limit: limit,
            ScanIndexForward: false
        };

        const restaurants = await fetchRestaurantsByIndex(params, cacheKey);
        res.status(200).json(restaurants);
    } catch (error) {
        console.error('GET /restaurants/region/:region/cuisine/:cuisine', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(80, () => {
    console.log('Server is running on http://localhost:80');
});

module.exports = { app };
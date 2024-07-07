const axios = require('axios');
const async = require('async');
const fs = require('fs');

// Configuration
const endPoint = 'http://Restau-LB8A1-F0OsCcwlXjg0-1497787654.us-east-1.elb.amazonaws.com';
const requestCount = 100; // Reduced for testing purposes
const concurrencyLevel = 4; // Number of concurrent requests

const restaurantName = 'ArielsRestaurantA';
const cuisineName = [
    "Thai", "Greek", "Mexican", "Korean", "Ethiopian", "Italian",
    "Japanese", "Indian", "Lebanese", "Turkish", "Spanish", "French",
    "Vietnamese", "Brazilian", "Russian", "American", "German", "Chinese",
    "Caribbean", "Portuguese", "Argentinian", "Peruvian", "Swedish", "Indonesian",
    "Malaysian", "Filipino", "Cuban", "Moroccan", "British", "Australian", "Canadian",
    "South African", "Egyptian", "Israeli", "Irish", "Scottish", "Dutch", "Belgian"
];
const regionName = [
    "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia",
    "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville",
    "Fort Worth", "Columbus", "Charlotte", "San Francisco", "Indianapolis",
    "Seattle", "Denver", "Washington", "Boston", "El Paso", "Nashville",
    "Detroit", "Oklahoma City", "Portland", "Las Vegas", "Memphis", "Louisville",
    "Baltimore", "Milwaukee", "Albuquerque", "Tucson", "Fresno", "Mesa", "Sacramento",
    "Atlanta", "Kansas City", "Colorado Springs", "Miami", "Raleigh", "Omaha",
    "Long Beach", "Virginia Beach", "Oakland", "Minneapolis", "Tulsa", "Tampa", "Arlington", "New Orleans"
    , "Wichita", "Cleveland", "Bakersfield", "Aurora", "Anaheim", "Honolulu", "Santa Ana", "Riverside"
];

// Function to make an HTTP POST request
const makePostRequest = (i, cacheEnabled, done) => {
    const RestaurantAName = restaurantName + i;
    const restaurant = { name: RestaurantAName, cuisine: cuisineName[i % cuisineName.length], region: regionName[i % regionName.length], cache: cacheEnabled };

    const startTime = Date.now();
    axios.post(`${endPoint}/restaurants`, restaurant)
        .then(response => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const log = `POST /restaurants Status: ${response.status}, Time Taken: ${duration} ms\n`;
            const fileName = cacheEnabled ? 'load_test_results_with_cache.txt' : 'load_test_results_without_cache.txt';
            fs.appendFileSync(fileName, log);
            console.log(log);
            done(null, duration);
        })
        .catch(error => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const log = `POST /restaurants Error: ${error.response ? error.response.status : error.message}, Time Taken: ${duration} ms\n`;
            const fileName = cacheEnabled ? 'load_test_results_with_cache.txt' : 'load_test_results_without_cache.txt';
            fs.appendFileSync(fileName, log);
            console.error(log);
            done(error, duration);
        });
};

// Function to make an HTTP GET request
const makeGetRequest = (i, cacheEnabled, done) => {
    const RestaurantAName = restaurantName + i;
    const startTime = Date.now();
    axios.get(`${endPoint}/restaurants/${RestaurantAName}`, { params: { cache: cacheEnabled } })
        .then(response => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const log = `GET /restaurants/${RestaurantAName} Status: ${response.status}, Time Taken: ${duration} ms\n`;
            const fileName = cacheEnabled ? 'load_test_results_with_cache.txt' : 'load_test_results_without_cache.txt';
            fs.appendFileSync(fileName, log);
            console.log(log);
            done(null, duration);
        })
        .catch(error => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const log = `GET /restaurants/${RestaurantAName} Error: ${error.response ? error.response.status : error.message}, Time Taken: ${duration} ms\n`;
            const fileName = cacheEnabled ? 'load_test_results_with_cache.txt' : 'load_test_results_without_cache.txt';
            fs.appendFileSync(fileName, log);
            console.error(log);
            done(error, duration);
        });
};

// Function to make an HTTP DELETE request
const makeDeleteRequest = (i, cacheEnabled, done) => {
    const RestaurantAName = restaurantName + i;
    const startTime = Date.now();
    axios.delete(`${endPoint}/restaurants/${RestaurantAName}`, { params: { cache: cacheEnabled } })
        .then(response => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const log = `DELETE /restaurants/${RestaurantAName} Status: ${response.status}, Time Taken: ${duration} ms\n`;
            const fileName = cacheEnabled ? 'load_test_results_with_cache.txt' : 'load_test_results_without_cache.txt';
            fs.appendFileSync(fileName, log);
            console.log(log);
            done(null, duration);
        })
        .catch(error => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const log = `DELETE /restaurants/${RestaurantAName} Error: ${error.response ? error.response.status : error.message}, Time Taken: ${duration} ms\n`;
            const fileName = cacheEnabled ? 'load_test_results_with_cache.txt' : 'load_test_results_without_cache.txt';
            fs.appendFileSync(fileName, log);
            console.error(log);
            done(error, duration);
        });
};

// Main function to perform the load test
const loadTest = (cacheEnabled) => {
    const tasks = [];

    // Add POST requests to tasks
    for (let i = 1; i <= requestCount; i++) {
        tasks.push(done => makePostRequest(i, cacheEnabled, done));
    }

    // Add GET requests to tasks
    for (let i = 1; i <= requestCount; i++) {
        tasks.push(done => makeGetRequest(i, cacheEnabled, done));
    }

    // Add DELETE requests to tasks
    for (let i = 1; i <= requestCount; i++) {
        tasks.push(done => makeDeleteRequest(i, cacheEnabled, done));
    }

    // Execute all tasks with concurrency limit
    async.parallelLimit(tasks, concurrencyLevel, (err, results) => {
        if (err) {
            console.error('A request failed:', err);
        } else {
            console.log('All requests completed successfully.');
            const totalDuration = results.reduce((total, current) => total + current, 0);
            const averageDuration = totalDuration / results.length;
            const log = `Average Request Time: ${averageDuration} ms\n`;
            const fileName = cacheEnabled ? 'load_test_results_with_cache.txt' : 'load_test_results_without_cache.txt';
            fs.appendFileSync(fileName, log);
            console.log(log);
        }
    });
};

// // Start the load testing
console.log('Starting load test with cache enabled...');
loadTest(true);

// console.log('Starting load test with cache disabled...');
// loadTest(false);

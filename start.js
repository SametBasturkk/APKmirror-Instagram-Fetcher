const cheerio = require('cheerio');
const axios = require('axios');
var cors = require('cors');
const { MongoClient } = require('mongodb');
const express = require('express');

// Initialize express app and set the port
const app = express();
const port = 3001;
app.use(express.json());
app.use(cors());

// Declare variables
var countOfPage = 1;
var latestVersions = [];
var versionVariants = [];
const howManyLatestVersions = 10;

// Set MongoDB connection details
const dbUrl = 'mongodb://127.0.0.1:27017';
const client = new MongoClient(dbUrl);
const dbName = 'oxo';

// Function to get the latest version of Instagram app
async function getLatestVersions() {
  var url =
    'https://www.apkmirror.com/uploads/page/' +
    countOfPage +
    '/?appcategory=instagram-instagram';

  try {
    // Send a GET request to the URL and parse the response
    let { data: body } = await axios.get(url);
    const $ = cheerio.load(body);
    const attr = $('h5.appRowTitle.wrapText.marginZero.block-on-mobile').text();

    // Extract version information and add to latestVersions array
    attr.split('\n').forEach(async function (item) {
      if (
        item.includes('Instagram') &&
        !item.includes('beta') &&
        !item.includes('alpha') &&
        !latestVersions.includes(item)
      ) {
        latestVersions.push(item);
      }
    });
    countOfPage++;
  } catch (error) {
    console.error(error);
  }
  console.log('Count of Final Versions Parsed: ' + latestVersions.length);
  return latestVersions;
}

// Function to get version information for a specific version of Instagram app
async function versionInformation(versionName) {
  const versionNumber = versionName.split(' ')[1].split('.').join('-');
  var url =
    'https://www.apkmirror.com/apk/instagram/instagram-instagram/instagram-instagram-' +
    versionNumber +
    '-release/';
  const data = [];

  try {
    // Send a GET request to the URL and parse the response
    let { data: body } = await axios.get(url);
    const $ = cheerio.load(body);
    $('.table-row.headerFont').each(function (i, elem) {
      const variant = {};
      variant.releaseDate = $(this).find('.dateyear_utc').text();
      variant.variantId = $(this).find('.colorLightBlack').first().text();
      variant.variantName = $(this).find('.accent_color').first().text().trim();
      variant.architecture = $(this).find('.table-cell').eq(1).text();
      variant.minVersion = $(this).find('.table-cell').eq(2).text();
      variant.screenDPI = $(this).find('.table-cell').eq(3).text();
      data.push(variant);
    });
  } catch (error) {
    console.error(error);
  }

  // Remove the first element of the data array
  data.splice(0, 1);

  // Add version information to versionVariants array
  versionVariants.push({
    versionName: versionName.split(' ')[1],
    versionReleaseDate: data[data.length - 1].releaseDate,
    versionVariantCount: data.length,
    versionVariantsData: data,
  });
}

async function main() {
  // Connect to MongoDB
  await client.connect();
  console.log('Connected successfully to server');
  const db = client.db(dbName);
  // Clear the existing data in the database
  db.dropDatabase();
  const collection = db.collection('instagram');

  // Scrape the latest version information until we have the desired number of versions
  while (latestVersions.length < howManyLatestVersions) {
    await getLatestVersions();
  }

  // Use map function to get version information for all versions in the latestVersions array
  const versionPromises = latestVersions.map(versionInformation);
  await Promise.all(versionPromises);

  // Save the version information to the MongoDB collection
  collection.insertMany(versionVariants);
  console.log('Saved To DB');

  // Route to retrieve all version information from the database
  app.get('/readAll', (req, res) => {
    const response = [];

    collection.find({}).toArray(function (err, result) {
      for (var i = 0; i < result.length; i++) {
        response.push({
          versionName: result[i].versionName,
          versionReleaseDate: result[i].versionReleaseDate,
          versionVariantCount: result[i].versionVariantCount,
          versionVariantsData: result[i].versionVariantsData,
        });
      }
      res.send(response);
    });
  });

  app.post('/delete', (req, res) => {
    collection.deleteMany(
      {
        versionName: req.body.versionName,
      },
      function (err, obj) {
        if (err) throw err;
        res.send(obj);
      }
    );
  });

  app.post('/variant', (req, res) => {
    collection
      .find({
        versionName: req.body.variantName,
      })
      .toArray(function (err, result) {
        if (err) throw err;
        res.send(result);
      });
  });

  app.post('/update', (req, res) => {
    collection.updateMany(
      {
        versionName: req.body.versionName,
      },
      {
        $set: {
          versionName: req.body.versionName,
          versionReleaseDate: req.body.versionReleaseDate,
        },
      },
      function (err, result) {
        if (err) throw err;
        res.send(result);
      }
    );
  });

  app.post('/connect', async (req, res) => {
    const str = req.query.agent;

    const appVersionRegex = /(\d+\.\d+\.\d+\.\d+.\d+)/;
    const androidVersionRegex = /\d+\/\d+/;
    const dpiRegex = /(\d+)dpi;/;
    const idRegex = /\d{9}/;

    const appVersion = str.match(appVersionRegex)[0];
    const androidVersion = str.match(androidVersionRegex)[0].split('/')[1];
    const dpi = str.match(dpiRegex)[1];
    const id = str.match(idRegex)[0];

    var selectedVariant = {};
    var androidCompatible;
    await collection
      .find({ versionName: appVersion })
      .toArray(function (err, result) {
        for (var i = 0; i < result[0].versionVariantsData.length; i++) {
          if (result[0].versionVariantsData[i].variantId == id) {
            selectedVariant = result[0].versionVariantsData[i];
          }
        }
        androidCompatible = selectedVariant.minVersion;
        if (
          androidCompatible <= androidVersion &&
          dpi < selectedVariant.screenDPI
        ) {
          console.log('Device is compatible with the selected variant');
          res.send('true');
        } else {
          console.log('Device is not compatible with the selected variant');
          res.send('false');
        }
      });
  });

  // Start the server
  app.listen(port, () =>
    console.log(`Example app listening at http://localhost:${port}`)
  );
}

main();

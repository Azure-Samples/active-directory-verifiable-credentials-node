// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Verifiable Credentials Sample

///////////////////////////////////////////////////////////////////////////////////////
// Node packages
var express = require('express')
var session = require('express-session')
var base64url = require('base64url')
var secureRandom = require('secure-random');
var bodyParser = require('body-parser')
var fetch = require( 'node-fetch' );
const https = require('https')
const url = require('url')
const { SSL_OP_COOKIE_EXCHANGE } = require('constants');
var msal = require('@azure/msal-node');
const fs = require('fs');
const crypto = require('crypto');

///////////////////////////////////////////////////////////////////////////////////////
// config file can come from command line, env var or the default
var configFile = process.argv.slice(2)[0];
if ( !configFile ) {
  configFile = process.env.CONFIGFILE || './config.json';
}
const config = require( configFile )
if (!config.azTenantId) {
  throw new Error('The config.json file is missing.')
}
module.exports.config = config;

///////////////////////////////////////////////////////////////////////////////////////
// MSAL
var msalConfig = {
  auth: {
      clientId: config.azClientId,
      authority: `https://login.microsoftonline.com/${config.azTenantId}`,
      clientSecret: config.azClientSecret,
  },
  system: {
      loggerOptions: {
          loggerCallback(loglevel, message, containsPii) {
              console.log(message);
          },
          piiLoggingEnabled: false,
          logLevel: msal.LogLevel.Verbose,
      }
  }
};

// if certificateName is specified in config, then we change the MSAL config to use it
if ( config.azCertificateName !== '') {
  const privateKeyData = fs.readFileSync(config.azCertificatePrivateKeyLocation, 'utf8');
  console.log(config.azCertThumbprint);  
  const privateKeyObject = crypto.createPrivateKey({ key: privateKeyData, format: 'pem',    
    passphrase: config.azCertificateName.replace("CN=", "") // the passphrase is the appShortName (see Configure.ps1)    
  });
  msalConfig.auth = {
    clientId: config.azClientId,
    authority: `https://login.microsoftonline.com/${config.azTenantId}`,
    clientCertificate: {
      thumbprint: config.azCertThumbprint,
      privateKey: privateKeyObject.export({ format: 'pem', type: 'pkcs8' })
    }
  };
}

const cca = new msal.ConfidentialClientApplication(msalConfig);
const msalClientCredentialRequest = {
  scopes: ["bbb94529-53a3-4be5-a069-7eaf2712b826/.default"],
  skipCache: false, 
};
module.exports.msalCca = cca;
module.exports.msalClientCredentialRequest = msalClientCredentialRequest;

///////////////////////////////////////////////////////////////////////////////////////
// Main Express server function
// Note: You'll want to update port values for your setup.
const app = express()
const port = process.env.PORT || 8080;

var parser = bodyParser.urlencoded({ extended: false });

// Serve static files out of the /public directory
app.use(express.static('public'))

// Set up a simple server side session store.
// The session store will briefly cache issuance requests
// to facilitate QR code scanning.
var sessionStore = new session.MemoryStore();
app.use(session({
  secret: 'cookie-secret-key',
  resave: false,
  saveUninitialized: true,
  store: sessionStore
}))

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Authorization, Origin, X-Requested-With, Content-Type, Accept");
  next();
});

module.exports.sessionStore = sessionStore;
module.exports.app = app;

function requestTrace( req ) {
  var dateFormatted = new Date().toISOString().replace("T", " ");
  var h1 = '//****************************************************************************';
  console.log( `${h1}\n${dateFormatted}: ${req.method} ${req.protocol}://${req.headers["host"]}${req.originalUrl}` );
  console.log( `Headers:`)
  console.log(req.headers);
}

// echo function so you can test that you can reach your deployment
app.get("/echo",
    function (req, res) {
        requestTrace( req );
        res.status(200).json({
            'date': new Date().toISOString(),
            'api': req.protocol + '://' + req.hostname + req.originalUrl,
            'Host': req.hostname,
            'x-forwarded-for': req.headers['x-forwarded-for'],
            'x-original-host': req.headers['x-original-host']
            });
    }
);

// Serve index.html as the home page
app.get('/', function (req, res) { 
  requestTrace( req );
  res.sendFile('public/index.html', {root: __dirname})
})

var verifier = require('./verifier.js');
var issuer = require('./issuer.js');

// start server
app.listen(port, () => console.log(`Example issuer app listening on port ${port}!`))

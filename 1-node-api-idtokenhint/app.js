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
// mod.cjs
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const https = require('https')
const url = require('url')
const { SSL_OP_COOKIE_EXCHANGE } = require('constants');
var msal = require('@azure/msal-node');
const fs = require('fs');
const crypto = require('crypto');
var uuid = require('uuid');

console.time("startup");
///////////////////////////////////////////////////////////////////////////////////////
// config file can come from command line, env var or the default
var config = {
  azTenantId : process.env.azTenantId,
  azClientId : process.env.azClientId,
  azClientSecret: process.env.azClientSecret,
  azCertificateName:  process.env.azCertificateName,
  azCertThumbprint:  process.env.azCertThumbprint,
  azCertificatePrivateKeyLocation:  process.env.azCertificatePrivateKeyLocation,
  CredentialManifest: process.env.CredentialManifest,
  DidAuthority: process.env.DidAuthority,
  acceptedIssuers: process.env.acceptedIssuers,
  CredentialType: process.env.CredentialType,
  issuancePinCodeLength: process.env.issuancePinCodeLength,
  sourcePhotoClaimName: process.env.photoClaimName,
  matchConfidenceThreshold: process.env.matchConfidenceThreshold
};
var configFile = process.env.CONFIGFILE;
if ( !configFile ) {
  var idx = process.argv.findIndex((el) => el == "-c");
  if ( idx != -1 ) {
    configFile = process.argv[idx+1];
  }
}
if ( configFile ) {
  config = require( configFile );
}
if ( !config.azCertificateName ) {
  config.azCertificateName = "";
} else {
  config.azCertificateName = (config.azCertificateName.startsWith("<") ? "" : config.azCertificateName);
}
if ( config.issuancePinCodeLength ) {
  config.issuancePinCodeLength = parseInt( config.issuancePinCodeLength );
}
console.log(config);
if (!config.azTenantId) {
  throw new Error('azTenantId is missing in the config.')
}
module.exports.config = config;

config.apiKey = uuid.v4();
///////////////////////////////////////////////////////////////////////////////////////
//
if ( config.CredentialManifest ) {
  // Check that the manifestURL have the matching tenantId with the config file
  var manifestUrl = config.CredentialManifest.split("/")[5];
  if(  config.azTenantId != manifestUrl ) {
    throw new Error( `TenantId in ManifestURL ${manifestUrl}. does not match tenantId in config file ${config.azTenantId}` );
  }
  // Check that the issuer in the config file match the manifest
  fetch( config.CredentialManifest, { method: 'GET'} )
    .then(res => res.json())
    .then((resp) => {
      if ( !resp.token ) {
        throw new Error( `Could not retrieve manifest from URL ${config.CredentialManifest}` );
      }
      config.manifest = JSON.parse(base64url.decode(resp.token.split(".")[1]));
      // if you don't specify DidAuthority in the config file, use the issuer DID from the manifest
      if ( config.DidAuthority == "" ) {
        config.DidAuthority = config.manifest.iss;
      }
      if ( config.manifest.iss != config.DidAuthority ) {
        throw new Error( `Wrong DidAuthority in config file ${config.DidAuthority}. Issuer in manifest is ${config.manifest.iss}` );
      }
      if ( config.manifest.input.attestations.idTokens ) {
        if ( config.manifest.input.attestations.idTokens[0].configuration == "https://self-issued.me" ) {
          config.claims = config.manifest.input.attestations.idTokens[0].claims;
        }
      }
    }); 
}
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
  scopes: ["3db474b9-6a0c-4840-96ac-1fceb342124f/.default"],
  skipCache: false, 
};
module.exports.msalCca = cca;
module.exports.msalClientCredentialRequest = msalClientCredentialRequest;


if ( !config.msIdentityHostName ) {
  if ( config.CredentialManifest ) {
    config.msIdentityHostName = config.CredentialManifest.split("tenants/")[0];
  } else {
    config.msIdentityHostName = "https://verifiedid.did.msidentity.com/v1.0/";
  }
}
console.log(`Verified ID endpoint: ${config.msIdentityHostName}`);
///////////////////////////////////////////////////////////////////////////////////////
// check that we a) can acquire an access_token and b) that it has the needed permission for this sample
cca.acquireTokenByClientCredential(msalClientCredentialRequest).then((result) => {
  if ( !result.accessToken ) {
    throw new Error( `Could not acquire access token. Check your configuration for tenant ${config.azTenantId} and clientId ${config.azClientId}` );
  } else {
    console.log( `access_token: ${result.accessToken}` ); 
    var accessToken = JSON.parse(base64url.decode(result.accessToken.split(".")[1]));
    if ( accessToken.roles != "VerifiableCredential.Create.All" ) {
      throw new Error( `Access token do not have the required scope 'VerifiableCredential.Create.All'.` );  
    }
  }
}).catch((error) => {
    console.log(error);
    throw new Error( `Could not acquire access token. Check your configuration for tenant ${config.azTenantId} and clientId ${config.azClientId}` );
  });

///////////////////////////////////////////////////////////////////////////////////////
// Check if it is an EU tenant and set up the endpoint for it
fetch( `https://login.microsoftonline.com/${config.azTenantId}/v2.0/.well-known/openid-configuration`, { method: 'GET'} )
.then(res => res.json())
.then((resp) => {
  console.log( `tenant_region_scope = ${resp.tenant_region_scope}`);
  config.tenant_region_scope = resp.tenant_region_scope;
  // Check that the Credential Manifest URL is in the same tenant Region and throw an error if it's not
  if ( config.CredentialManifest && !config.msIdentityHostName.startsWith("https://dev.did.msidentity.com/v1.0/") && !config.CredentialManifest.startsWith(config.msIdentityHostName) ) {
    throw new Error( `Error in config file. CredentialManifest URL configured for wrong tenant region. Should start with: ${config.msIdentityHostName}` );
  }
}); 

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

function getSessionData( id, callback ) {
  sessionStore.get( id, (error, session) => {
    callback(session);
  });
}
function getSessionDataWrapper( id ) {
  return new Promise((resolve, reject) => {
    getSessionData(id, (goodResponse) => {
      resolve(goodResponse);
    }, (badResponse) => {
      reject(badResponse);
    });
  });
}
module.exports.getSessionDataWrapper = getSessionDataWrapper;

function requestTrace( req ) {
  var dateFormatted = new Date().toISOString().replace("T", " ");
  var h1 = '//****************************************************************************';
  console.log( `${h1}\n${dateFormatted}: ${req.method} ${req.protocol}://${req.headers["host"]}${req.originalUrl}` );
  console.log( `Headers:`)
  console.log(req.headers);
}
module.exports.requestTrace = requestTrace;

// echo function so you can test that you can reach your deployment
app.get("/echo",
    function (req, res) {
        requestTrace( req );
        res.status(200).json({
            'date': new Date().toISOString(),
            'api': req.protocol + '://' + req.hostname + req.originalUrl,
            'Host': req.hostname,
            'x-forwarded-for': req.headers['x-forwarded-for'],
            'x-original-host': req.headers['x-original-host'],
            'DidAuthority': config.DidAuthority,
            'manifestURL': config.CredentialManifest,
            'clientId': config.azClientId,
            'configFile': configFile
            });
    }
);

// Serve index.html as the home page
app.get('/', function (req, res) { 
  requestTrace( req );
  res.sendFile('public/index.html', {root: __dirname})
})

var verifier = require('./verifier.js');
if ( config.CredentialManifest ) {
  var issuer = require('./issuer.js');
}
var callback = require('./callback.js');

console.timeEnd("startup");
// start server
app.listen(port, () => console.log(`Example issuer app listening on port ${port}!`))

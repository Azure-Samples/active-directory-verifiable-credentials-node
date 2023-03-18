// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Verifiable Credentials Issuer Sample

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
var mainApp = require('./app.js');

var parser = bodyParser.urlencoded({ extended: false });

///////////////////////////////////////////////////////////////////////////////////////
// Setup the issuance request payload template
//////////// Setup the issuance request payload template
var requestConfigFile = process.argv.slice(2)[1];
if ( !requestConfigFile ) {
  requestConfigFile = process.env.ISSUANCEFILE || './issuance_request_config.json';
}
var issuanceConfig = require( requestConfigFile );
issuanceConfig.registration.clientName = "Node.js Verified ID sample";
// get the manifest from config.json, this is the URL to the credential created in the azure portal. 
// the display and rules file to create the credential can be found in the credentialfiles directory
// make sure the credentialtype in the issuance payload ma
issuanceConfig.authority = mainApp.config["IssuerAuthority"]
issuanceConfig.manifest = mainApp.config["CredentialManifest"]
// if there is pin code in the config, but length is zero - remove it. It really shouldn't be there
if ( issuanceConfig.pin && issuanceConfig.pin.length == 0 ) {
  issuanceConfig.pin = null;
}
if ( issuanceConfig.callback.headers ) {
  issuanceConfig.callback.headers['api-key'] = mainApp.config["apiKey"];
}

console.log( `api-key: ${mainApp.config["apiKey"]}` );

function requestTrace( req ) {
  var dateFormatted = new Date().toISOString().replace("T", " ");
  var h1 = '//****************************************************************************';
  console.log( `${h1}\n${dateFormatted}: ${req.method} ${req.protocol}://${req.headers["host"]}${req.originalUrl}` );
  console.log( `Headers:`)
  console.log(req.headers);
}

function generatePin( digits ) {
  var add = 1, max = 12 - add;
  max        = Math.pow(10, digits+add);
  var min    = max/10; // Math.pow(10, n) basically
  var number = Math.floor( Math.random() * (max - min + 1) ) + min;
  return ("" + number).substring(add); 
}
/**
 * This method is called from the UI to initiate the issuance of the verifiable credential
 */
mainApp.app.get('/api/issuer/issuance-request', async (req, res) => {
  requestTrace( req );
  var id = req.session.id;
  // prep a session state of 0
  mainApp.sessionStore.get( id, (error, session) => {
    var sessionData = {
      "status" : 0,
      "message": "Waiting for QR code to be scanned"
    };
    if ( session ) {
      session.sessionData = sessionData;
      mainApp.sessionStore.set( id, session);  
    }
  });

  // get the Access Token
  var accessToken = "";
  try {
    const result = await mainApp.msalCca.acquireTokenByClientCredential(mainApp.msalClientCredentialRequest);
    if ( result ) {
      accessToken = result.accessToken;
    }
  } catch {
    console.log( "failed to get access token" );
    res.status(401).json({
        'error': 'Could not acquire credentials to access your Azure Key Vault'
        });  
      return; 
  }
  console.log( `accessToken: ${accessToken}` );

  issuanceConfig.authority = mainApp.config["IssuerAuthority"]
  // modify the callback method to make it easier to debug 
  // with tools like ngrok since the URI changes all the time
  // this way you don't need to modify the callback URL in the payload every time
  // ngrok changes the URI
  issuanceConfig.callback.url = `https://${req.hostname}/api/issuer/issuance-request-callback`;
  // modify payload with new state, the state is used to be able to update the UI when callbacks are received from the VC Service
  issuanceConfig.callback.state = id;
  // check if pin is required, if found make sure we set a new random pin
  // pincode is only used when the payload contains claim value pairs which results in an IDTokenhint
  if ( issuanceConfig.pin ) {
    // don't use pin if user is on mobile device
    if ( req.headers["user-agent"].includes("Android") || req.headers["user-agent"].includes('iPhone')) {
      delete issuanceConfig.pin;
    } else {
      issuanceConfig.pin.value = generatePin( issuanceConfig.pin.length );
    }
  }
  // here you could change the payload manifest and change the firstname and lastname
  if ( issuanceConfig.claims ) {
    if ( issuanceConfig.claims.given_name ) {
      issuanceConfig.claims.given_name = "Megan";
    }
    if ( issuanceConfig.claims.family_name ) {
      issuanceConfig.claims.family_name = "Bowen";
    }
  }

  console.log( 'Request Service API Request' );
  var client_api_request_endpoint = `${mainApp.config.msIdentityHostName}verifiableCredentials/createIssuanceRequest`;
  console.log( client_api_request_endpoint );
  console.log( issuanceConfig );

  var payload = JSON.stringify(issuanceConfig);
  const fetchOptions = {
    method: 'POST',
    body: payload,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length.toString(),
      'Authorization': `Bearer ${accessToken}`
    }
  };

  const response = await fetch(client_api_request_endpoint, fetchOptions);
  var resp = await response.json()
  // the response from the VC Request API call is returned to the caller (the UI). It contains the URI to the request which Authenticator can download after
  // it has scanned the QR code. If the payload requested the VC Request service to create the QR code that is returned as well
  // the javascript in the UI will use that QR code to display it on the screen to the user.            
  resp.id = id;                              // add session id so browser can pull status
  if ( issuanceConfig.pin ) {
    resp.pin = issuanceConfig.pin.value;   // add pin code so browser can display it
  }
  console.log( 'VC Client API Response' );
  console.log( response.status );
  console.log( resp );  
  if ( response.status > 299 ) {
    res.status(400).json( resp.error );  
} else {
    res.status(200).json( resp );       
  }
})
/**
 * This method is called by the VC Request API when the user scans a QR code and presents a Verifiable Credential to the service
 */
mainApp.app.post('/api/issuer/issuance-request-callback', parser, async (req, res) => {
  var body = '';
  req.on('data', function (data) {
    body += data;
  });
  req.on('end', function () {
    requestTrace( req );
    console.log( body );
    // the api-key is set at startup in app.js. If not present in callback, the call should be rejected
    if ( req.headers['api-key'] != mainApp.config["apiKey"] ) {
      res.status(401).json({'error': 'api-key wrong or missing'});  
      return; 
    }
    var issuanceResponse = JSON.parse(body.toString());
    var cacheData;
    switch ( issuanceResponse.requestStatus ) {
      // this callback signals that the request has been retrieved (QR code scanned, etc)
      case "request_retrieved":
        cacheData = {
          "status": issuanceResponse.requestStatus,
          "message": "QR Code is scanned. Waiting for validation..."
        };
      break;
      // this callback signals that issuance of the VC was successful and the VC is now in the wallet
      case "issuance_successful":
        var cacheData = {
          "status" : issuanceResponse.requestStatus,
          "message": "Credential successfully issued"
        };
      break;
      // this callback signals that issuance did not complete. It could be for technical reasons or that the user didn't accept it
      case "issuance_error":
        var cacheData = {
          "status" : issuanceResponse.requestStatus,
          "message": issuanceResponse.error.message,
          "payload": issuanceResponse.error.code
        };
      break;
      default:
        console.log( `400 - Unsupported requestStatus: ${issuanceResponse.requestStatus}` );
        res.status(400).json({'error': `Unsupported requestStatus: ${issuanceResponse.requestStatus}`});      
        return;
    }
    // store the session state so the UI can pick it up and progress
    mainApp.sessionStore.get( issuanceResponse.state, (error, session) => {
      if ( session ) {
        session.sessionData = cacheData;
        mainApp.sessionStore.set( issuanceResponse.state, session, (error) => {
          console.log( "200 - OK");
          res.send();
        });
      } else {
        console.log( `400 - Unknown state: ${issuanceResponse.state}` );
        res.status(400).json({'error': `Unknown state: ${issuanceResponse.state}`});      
        return;
      }
    })      
  });  
})
/**
 * this function is called from the UI polling for a response from the AAD VC Service.
 * when a callback is received at the presentationCallback service the session will be updated
 * this method will respond with the status so the UI can reflect if the QR code was scanned and with the result of the presentation
 */
mainApp.app.get('/api/issuer/issuance-response', async (req, res) => {
  var id = req.query.id;
  requestTrace( req );
  mainApp.sessionStore.get( id, (error, session) => {
    if (session && session.sessionData) {
      console.log(`200 - status: ${session.sessionData.status}, message: ${session.sessionData.message}`);
      res.status(200).json(session.sessionData);   
    } else {
      console.log( `400 - Unknown state: ${id}` );
      res.status(400).json({'error': `Unknown state: ${id}`});      
    }
  })
})

mainApp.app.get('/api/issuer/get-manifest', async (req, res) => {
  var id = req.query.id;
  requestTrace( req );
  res.status(200).json(mainApp.config["manifest"]);   
})

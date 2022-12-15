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
var uuid = require('uuid');
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
issuanceConfig.registration.clientName = "Node.js SDK API Issuer";
// get the manifest from config.json, this is the URL to the credential created in the azure portal. 
// the display and rules file to create the credential can be found in the credentialfiles directory
// make sure the credentialtype in the issuance payload ma
issuanceConfig.authority = mainApp.config["IssuerAuthority"]
issuanceConfig.manifest = mainApp.config["CredentialManifest"]
// if there is pin code in the config, but length is zero - remove it. It really shouldn't be there
if ( issuanceConfig.pin && issuanceConfig.pin.length == 0 ) {
  issuanceConfig.pin = null;
}
var apiKey = uuid.v4();
if ( issuanceConfig.callback.headers ) {
  issuanceConfig.callback.headers['api-key'] = apiKey;
}

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
    issuanceConfig.claims.given_name = "Megan";
    issuanceConfig.claims.family_name = "Bowen";
  }

  console.log( 'VC Client API Request' );
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
    if ( req.headers['api-key'] != apiKey ) {
      res.status(401).json({
        'error': 'api-key wrong or missing'
        });  
      return; 
    }
    var issuanceResponse = JSON.parse(body.toString());
    var message = null;
    // there are 2 different callbacks. 1 if the QR code is scanned (or deeplink has been followed)
    // Scanning the QR code makes Authenticator download the specific request from the server
    // the request will be deleted from the server immediately.
    // That's why it is so important to capture this callback and relay this to the UI so the UI can hide
    // the QR code to prevent the user from scanning it twice (resulting in an error since the request is already deleted)
    if ( issuanceResponse.requestStatus == "request_retrieved" ) {
      message = "QR Code is scanned. Waiting for issuance to complete...";
      mainApp.sessionStore.get(issuanceResponse.state, (error, session) => {
        var sessionData = {
          "status" : "request_retrieved",
          "message": message
        };
        session.sessionData = sessionData;
        mainApp.sessionStore.set( issuanceResponse.state, session, (error) => {
          res.send();
        });
      })      
    }

    if ( issuanceResponse.requestStatus == "issuance_successful" ) {
      message = "Credential successfully issued";
      mainApp.sessionStore.get(issuanceResponse.state, (error, session) => {
        var sessionData = {
          "status" : "issuance_successful",
          "message": message
        };
        session.sessionData = sessionData;
        mainApp.sessionStore.set( issuanceResponse.state, session, (error) => {
          res.send();
        });
      })      
    }

    if ( issuanceResponse.requestStatus == "issuance_error" ) {
      mainApp.sessionStore.get(issuanceResponse.state, (error, session) => {
        var sessionData = {
          "status" : "issuance_error",
          "message": issuanceResponse.error.message,
          "payload" :issuanceResponse.error.code
        };
        session.sessionData = sessionData;
        mainApp.sessionStore.set( issuanceResponse.state, session, (error) => {
          res.send();
        });
      })      
    }
    
    res.send()
  });  
  res.send()
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
      console.log(`status: ${session.sessionData.status}, message: ${session.sessionData.message}`);
      res.status(200).json(session.sessionData);   
      }
  })
})


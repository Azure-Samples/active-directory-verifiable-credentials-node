// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Verifiable Credentials Verifier Sample

///////////////////////////////////////////////////////////////////////////////////////
// Node packages
var http = require('http');
var fs = require('fs');
var path = require('path');
var express = require('express')
var session = require('express-session')
var bodyParser = require('body-parser')
var base64url = require('base64url')
// mod.cjs
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
var secureRandom = require('secure-random');
const https = require('https')
const url = require('url')
const { Console } = require('console');
var msal = require('@azure/msal-node');
var uuid = require('uuid');
var mainApp = require('./app.js');

var parser = bodyParser.urlencoded({ extended: false });

///////////////////////////////////////////////////////////////////////////////////////
// Setup the presentation request payload template
var requestConfigFile = process.argv.slice(2)[2];
if ( !requestConfigFile ) {
  requestConfigFile = process.env.PRESENTATIONFILE || './presentation_request_config.json';
}
var presentationConfig = require( requestConfigFile );
presentationConfig.registration.clientName = "Node.js SDK API Verifier";
presentationConfig.authority = mainApp.config["VerifierAuthority"]
// copy the issuerDID from the settings and fill in the acceptedIssuers part of the payload
// this means only that issuer should be trusted for the requested credentialtype
// this value is an array in the payload, you can trust multiple issuers for the same credentialtype
// very common to accept the test VCs and the Production VCs coming from different verifiable credential services
presentationConfig.requestedCredentials[0].acceptedIssuers[0] = mainApp.config["IssuerAuthority"]
var apiKey = uuid.v4();
if ( presentationConfig.callback.headers ) {
  presentationConfig.callback.headers['api-key'] = apiKey;
}

function requestTrace( req ) {
  var dateFormatted = new Date().toISOString().replace("T", " ");
  var h1 = '//****************************************************************************';
  console.log( `${h1}\n${dateFormatted}: ${req.method} ${req.protocol}://${req.headers["host"]}${req.originalUrl}` );
  console.log( `Headers:`)
  console.log(req.headers);
}
/**
 * This method is called from the UI to initiate the presentation of the verifiable credential
 */
mainApp.app.get('/api/verifier/presentation-request', async (req, res) => {
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
  presentationConfig.callback.url = `https://${req.hostname}/api/verifier/presentation-request-callback`;
  presentationConfig.callback.state = id;

  console.log( 'VC Client API Request' );
  var client_api_request_endpoint = `${mainApp.config.msIdentityHostName}verifiableCredentials/createPresentationRequest`;
  console.log( client_api_request_endpoint );
  var payload = JSON.stringify(presentationConfig);
  console.log( payload );
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
  resp.id = id;                              // add id so browser can pull status
  console.log( 'VC Client API Response' );
  console.log( resp );  
  res.status(200).json(resp);       
})

/**
 * This method is called by the VC Request API when the user scans a QR code and presents a Verifiable Credential to the service
 */
mainApp.app.post('/api/verifier/presentation-request-callback', parser, async (req, res) => {
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
    var presentationResponse = JSON.parse(body.toString());
    // there are 2 different callbacks. 1 if the QR code is scanned (or deeplink has been followed)
    // Scanning the QR code makes Authenticator download the specific request from the server
    // the request will be deleted from the server immediately.
    // That's why it is so important to capture this callback and relay this to the UI so the UI can hide
    // the QR code to prevent the user from scanning it twice (resulting in an error since the request is already deleted)            
    if ( presentationResponse.requestStatus == "request_retrieved" ) {
      mainApp.sessionStore.get( presentationResponse.state, (error, session) => {
        var cacheData = {
            "status": presentationResponse.requestStatus,
            "message": "QR Code is scanned. Waiting for validation..."
        };
        session.sessionData = cacheData;
        mainApp.sessionStore.set( presentationResponse.state, session, (error) => {
          res.send();
        });
      })      
    }
    // the 2nd callback is the result with the verified credential being verified.
    // typically here is where the business logic is written to determine what to do with the result
    // the response in this callback contains the claims from the Verifiable Credential(s) being presented by the user
    // In this case the result is put in the in memory cache which is used by the UI when polling for the state so the UI can be updated.
    if ( presentationResponse.requestStatus == "presentation_verified" ) {
      mainApp.sessionStore.get(presentationResponse.state, (error, session) => {
        var cacheData = {
            "status": presentationResponse.requestStatus,
            "message": "Presentation received",
            "payload": presentationResponse.verifiedCredentialsData,
            "subject": presentationResponse.subject,
            "firstName": presentationResponse.verifiedCredentialsData[0].claims.firstName,
            "lastName": presentationResponse.verifiedCredentialsData[0].claims.lastName,
            "presentationResponse": presentationResponse
        };
        session.sessionData = cacheData;
        mainApp.sessionStore.set( presentationResponse.state, session, (error) => {
          res.send();
        });
      })      
    }
  });  
  res.send()
})
/**
 * this function is called from the UI polling for a response from the AAD VC Service.
 * when a callback is recieved at the presentationCallback service the session will be updated
 * this method will respond with the status so the UI can reflect if the QR code was scanned and with the result of the presentation
 */
mainApp.app.get('/api/verifier/presentation-response', async (req, res) => {
  var id = req.query.id;
  requestTrace( req );
  mainApp.sessionStore.get( id, (error, session) => {
    if (session && session.sessionData) {
      console.log(`status: ${session.sessionData.status}, message: ${session.sessionData.message}`);
      if ( session.sessionData.status == "presentation_verified" ) {
        delete session.sessionData.presentationResponse; // browser don't need this
      }
      res.status(200).json(session.sessionData);   
      }
  })
})

/**
 * B2C REST API Endpoint for retrieveing the VC presentation response
 * body: The InputClaims from the B2C policy. It will only be one claim named 'id'
 * return: a JSON structure with claims from the VC presented
 */
var parserJson = bodyParser.json();
mainApp.app.post('/api/verifier/presentation-response-b2c', parserJson, async (req, res) => {
  var id = req.body.id;
  requestTrace( req );
  mainApp.sessionStore.get( id, (error, store) => {
    if (store && store.sessionData && store.sessionData.status == "presentation_verified" ) {
      console.log("Has VC. Will return it to B2C");      
      var claims = store.sessionData.presentationResponse.verifiedCredentialsData[0].claims;
      var claimsExtra = {
        'vcType': presentationConfig.presentation.requestedCredentials[0].type,
        'vcIss': store.sessionData.presentationResponse.verifiedCredentialsData[0].authority,
        'vcSub': store.sessionData.presentationResponse.subject,
        'vcKey': store.sessionData.presentationResponse.subject.replace("did:ion:", "did.ion.").split(":")[0]
        };        
        var responseBody = { ...claimsExtra, ...claims }; // merge the two structures
        req.session.sessionData = null; 
        console.log( responseBody );
        res.status(200).json( responseBody );   
    } else {
      console.log('Will return 409 to B2C');
      res.status(409).json({
        'version': '1.0.0', 
        'status': 400,
        'userMessage': 'Verifiable Credentials not presented'
        });   
    }
  })
})

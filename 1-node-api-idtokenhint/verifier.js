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
var mainApp = require('./app.js');

var parser = bodyParser.urlencoded({ extended: false });
var parserJson = bodyParser.json();

///////////////////////////////////////////////////////////////////////////////////////
// Setup the presentation request payload template
var presentationConfig = {
  "authority": "...set in code...",
  "includeQRCode": false,
  "callback": {
    "url": "...set in code...",
    "state": "...set in code...",
    "headers": {
      "api-key": "...set in code..."
    }
  },
  "registration": {
    "clientName": "...set in code...",
    "purpose": "...set in code..."
  },
  "includeReceipt": true,
  "requestedCredentials": [
    {
      "type": "...set in code...",
      "acceptedIssuers": [],
      "configuration": {
        "validation": {
          "allowRevoked": true,
          "validateLinkedDomain": true
        }
      }    
    }
  ]
};
// see if we got a template from 1) envvar or 2) cmd argv
var requestConfigFile = process.env.PRESENTATIONFILE;
if ( !requestConfigFile ) {
  var idx = process.argv.findIndex((el) => el == "-p");
  if ( idx != -1 ) {
    requestConfigFile = process.argv[idx+1];
  }
  if ( requestConfigFile ) {
    presentationConfig = require( requestConfigFile );
  }
}
function updatePresentationConfig(presentationConfig) {
  if ( mainApp.config["clientName"] ) {
    presentationConfig.registration.clientName = mainApp.config["clientName"];
  }
  if ( presentationConfig.registration.clientName.startsWith("...") ) {
    presentationConfig.registration.clientName = "Node.js Verified ID sample";
  }
  if ( mainApp.config["purpose"] ) {
    presentationConfig.registration.purpose = mainApp.config["purpose"];
  }
  if ( presentationConfig.registration.purpose.startsWith("...") ) {
    presentationConfig.registration.purpose = "To prove that you are an expert";
  }
  // copy the issuerDID from the settings and fill in the acceptedIssuers part of the payload
  // this means only that issuer should be trusted for the requested credentialtype
  // this value is an array in the payload, you can trust multiple issuers for the same credentialtype
  // very common to accept the test VCs and the Production VCs coming from different verifiable credential services
  if ( presentationConfig.callback.headers ) {
    presentationConfig.callback.headers['api-key'] = mainApp.config["apiKey"];
  }
}
updatePresentationConfig( presentationConfig );
if ( mainApp.config["CredentialType"] ) {
  presentationConfig.requestedCredentials[0].type = mainApp.config["CredentialType"]
}
presentationConfig.authority = mainApp.config["DidAuthority"]
if ( mainApp.config["acceptedIssuers"].includes("did:") ) {
    presentationConfig.requestedCredentials[0].acceptedIssuers = mainApp.config["acceptedIssuers"].split(";");
}

//console.log( presentationConfig );

///////////////////////////////////////////////////////////////////////////////////////
// This method is called from the UI to initiate the presentation of the credential
mainApp.app.get('/api/verifier/presentation-request', async (req, res) => {
  mainApp.requestTrace( req );
  var id = req.session.id;

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
        'error': 'Could not acquire access token to call Verified ID'
        });  
      return; 
  }
  console.log( `accessToken: ${accessToken}` );

  presentationConfig.authority = mainApp.config["DidAuthority"]
  presentationConfig.callback.url = `https://${req.hostname}/api/request-callback`;
  presentationConfig.callback.state = id;

  if ( req.query.faceCheck && req.query.faceCheck == "1" 
      && !presentationConfig.requestedCredentials[0].configuration.validation.faceCheck ) {
    var photoClaim = mainApp.config["sourcePhotoClaimName"] || photo;
    var confidenceThreshold = parseInt(mainApp.config["matchConfidenceThreshold"]) || 70;
    presentationConfig.requestedCredentials[0].configuration.validation.faceCheck = { 
                                                                          sourcePhotoClaimName: photoClaim,
                                                                          matchConfidenceThreshold: confidenceThreshold
                                                                        };
  }

  console.log( 'Request Service API Request' );
  var client_api_request_endpoint = `${mainApp.config.msIdentityHostName}verifiableCredentials/createPresentationRequest`;
  var payload = JSON.stringify(presentationConfig);
  // quickfix - createPresentationRequest with faceCheck must use beta endpoint
  if ( payload.includes("faceCheck")) {
    client_api_request_endpoint = client_api_request_endpoint.replace("/v1.0/", "/beta/");
  }
  console.log( client_api_request_endpoint );
  console.log( payload );
  const fetchOptions = {
    method: 'POST',
    body: payload,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length.toString(),
      'Authorization': `Bearer ${accessToken}`
      //, 'x-ms-did-target': `wus2`
    }
  };

  console.log( fetchOptions);
  console.time("createPresentationRequest");
  const response = await fetch(client_api_request_endpoint, fetchOptions);
  var resp = await response.json()
  console.timeEnd("createPresentationRequest");

  // the response from the VC Request API call is returned to the caller (the UI). It contains the URI to the request which Authenticator can download after
  // it has scanned the QR code. If the payload requested the VC Request service to create the QR code that is returned as well
  // the javascript in the UI will use that QR code to display it on the screen to the user.            
  resp.id = id;                              // add id so browser can pull status
  console.log( 'VC Client API Response' );
  console.log( resp );  
  
  if ( response.status > 299 ) {
    resp.error_description = `[${resp.error.innererror.code}] ${resp.error.message} ${resp.error.innererror.message}`;
    res.status(400).json( resp );  
  } else {
    // prep an initial session state
    var session = await mainApp.getSessionDataWrapper( id );
    if ( session ) {
      console.log( "Storing session data" );
      session.sessionData = {
        "status" : "request_created",
        "message": "Waiting for QR code to be scanned"
      };
      mainApp.sessionStore.set( id, session);
    }
    res.status(200).json( resp );       
  }
  
})

///////////////////////////////////////////////////////////////////////////////////////
// Return presented credential details to the UI
mainApp.app.get('/api/verifier/get-presentation-details', async (req, res) => {
  var id = req.query.id;
  mainApp.requestTrace( req );
  res.status(200).json({
    'clientName': presentationConfig.registration.clientName,
    'purpose': presentationConfig.registration.purpose,
    'DidAuthority': mainApp.config["DidAuthority"],
    'type': presentationConfig.requestedCredentials[0].type,
    'acceptedIssuers': presentationConfig.requestedCredentials[0].acceptedIssuers,
    'sourcePhotoClaimName': mainApp.config["sourcePhotoClaimName"]
    });   
})

mainApp.app.post('/api/verifier/load-template', parser, async (req, res) => {
  var body = '';
  req.on('data', function (data) {
    body += data;
  });
  req.on('end', function () {
    mainApp.requestTrace( req );
    console.log( "template passed:" );
    console.log( body );
    presentationConfig = JSON.parse( body );
    updatePresentationConfig( presentationConfig );
    console.log( "new presentationRequest:" );
    console.log( presentationConfig );
    res.status(200).json({
      'status': `template loaded`
      });
  });  
})

/**
 * B2C REST API Endpoint for retrieving the VC presentation response
 * body: The InputClaims from the B2C policy. It will only be one claim named 'id'
 * return: a JSON structure with claims from the VC presented
 */
mainApp.app.post('/api/verifier/presentation-response-b2c', parserJson, async (req, res) => {
  var id = req.body.id;
  mainApp.requestTrace( req );
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

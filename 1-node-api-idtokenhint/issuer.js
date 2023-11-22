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
var issuanceConfig = {
  "authority": "...set at runtime...",
  "includeQRCode": false,
  "registration": {
      "clientName": "...set at runtime...",
      "purpose": "...set at runtime.."
  },
  "callback": {
    "url": "...set at runtime...",
    "state": "...set at runtime...",
    "headers": {
       "api-key": "...set at runtime..."
    }
  },
  "type": "ignore-this",
  "manifest": "...set at runtime..."
};

// see if we got a template from 1) envvar or 2) cmd argv
var requestConfigFile = process.env.ISSUANCEFILE;
if ( !requestConfigFile ) {
  var idx = process.argv.findIndex((el) => el == "-i");
  if ( idx != -1 ) {
    requestConfigFile = process.argv[idx+1];
  }
  if ( requestConfigFile ) {
    issuanceConfig = require( requestConfigFile );
  }
}

if ( mainApp.config["clientName"] ) {
  issuanceConfig.registration.clientName = mainApp.config["clientName"];
}
if ( issuanceConfig.registration.clientName.startsWith("...") ) {
  issuanceConfig.registration.clientName = "Node.js Verified ID sample";
}
if ( mainApp.config["purpose"] ) {
  issuanceConfig.registration.purpose = mainApp.config["purpose"];
}
if ( issuanceConfig.registration.purpose.startsWith("...") ) {
  issuanceConfig.registration.purpose = "To issue you with an expert credential";
}
issuanceConfig.authority = mainApp.config["DidAuthority"]
issuanceConfig.manifest = mainApp.config["CredentialManifest"]

// if there is pin code in the config, but length is zero - remove it. It really shouldn't be there
if ( mainApp.config["issuancePinCodeLength"] && mainApp.config["issuancePinCodeLength"] > 0 ) {
  issuanceConfig.pin = { length: mainApp.config["issuancePinCodeLength"], value: '' };
}
if ( issuanceConfig.pin && issuanceConfig.pin.length == 0 ) {
  issuanceConfig.pin = null;
}
if ( issuanceConfig.callback.headers ) {
  issuanceConfig.callback.headers['api-key'] = mainApp.config["apiKey"];
}
//console.log( issuanceConfig );

///////////////////////////////////////////////////////////////////////////////////////
//
function generatePin( digits ) {
  var add = 1, max = 12 - add;
  max        = Math.pow(10, digits+add);
  var min    = max/10; // Math.pow(10, n) basically
  var number = Math.floor( Math.random() * (max - min + 1) ) + min;
  return ("" + number).substring(add); 
}

///////////////////////////////////////////////////////////////////////////////////////
// This method is called from the UI to initiate the issuance of the  credential
mainApp.app.get('/api/issuer/issuance-request', async (req, res) => {
  mainApp.requestTrace( req );
  var id = req.session.id;
  if ( req.query.id ) {
    id = req.query.id;
  }
  console.log( `id: ${id}` );

  var photo = null;
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
        'error': 'Could not acquire credentials to access Verified ID'
        });  
      return; 
  }
  console.log( `accessToken: ${accessToken}` );

  // prep an initial session state
  var session = await mainApp.getSessionDataWrapper( id );
  if ( session ) {
    if ( session.sessionData && session.sessionData.photo ) {
      photo = session.sessionData.photo;
    }
    session.sessionData = {
      "status" : "request_created",
      "message": "Waiting for QR code to be scanned"
    };
    mainApp.sessionStore.set( id, session);  
  }
  if ( null != photo ) {
    console.log( 'Photo set in session state');
  }
  
  issuanceConfig.authority = mainApp.config["DidAuthority"]
  issuanceConfig.callback.url = `https://${req.hostname}/api/request-callback`;
  issuanceConfig.callback.state = id;
  // if pin is required, then generate a pin code. 
  // pincode can only be used for idTokenHint attestation
  if ( issuanceConfig.pin ) {
    // don't use pin if user is on mobile device as it doesn't make sense
    if ( req.headers["user-agent"].includes("Android") || req.headers["user-agent"].includes('iPhone')) {
      delete issuanceConfig.pin;
    } else {
      issuanceConfig.pin.value = generatePin( issuanceConfig.pin.length );
    }
  }
  // copy claim names from manifest for idTokenHint - this is a bit extra and you can just set the claims below
  if ( mainApp.config["claims"] ) {
    issuanceConfig.claims = {};
    for (i = 0; i < mainApp.config["claims"].length; i++) {
      var claimName = mainApp.config["claims"][i].claim.replace("$.", "");
      issuanceConfig.claims[claimName] = "...set in code...";
    }
  } 

  // set the claim values - only for idTokenHint attestation
  if ( issuanceConfig.claims ) {
    if ( issuanceConfig.claims.given_name ) {
      issuanceConfig.claims.given_name = "Megan";
    }
    if ( issuanceConfig.claims.family_name ) {
      issuanceConfig.claims.family_name = "Bowen";
    }
    if ( issuanceConfig.claims.photo ) {
      console.log( 'We set a photo claim');
      issuanceConfig.claims.photo = photo;
    }
  }

  // call Verified ID Request Service issuance API
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

  console.time("createIssuanceRequest");
  const response = await fetch(client_api_request_endpoint, fetchOptions);
  var resp = await response.json()
  console.timeEnd("createIssuanceRequest");
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
    resp.error_description = `[${resp.error.innererror.code}] ${resp.error.message} ${resp.error.innererror.message}`;
    res.status(400).json( resp );  
  } else {
    res.status(200).json( resp );       
  }
})

///////////////////////////////////////////////////////////////////////////////////////
// Returns the manifest to the UI so it can use it in rendering
mainApp.app.get('/api/issuer/get-manifest', async (req, res) => {
  mainApp.requestTrace( req );
  var id = req.query.id;
  res.status(200).json(mainApp.config["manifest"]);   
})

///////////////////////////////////////////////////////////////////////////////////////
// sets a jpeg photo in the session state
function setUserPhoto( id, res, body ) {
  console.log( body );
  let idx = body.indexOf(";base64,");
  if ( -1 == idx ) {
    console.log( `400 - image must be data:image/jpeg;base64` );
    res.status(400).json({'error': `image must be data:image/jpeg;base64`});      
  } else {      
    //var id = req.session.id;
    //if ( req.query.id ) {
    //  id = req.query.id;
    //}
    console.log( `id: ${id}` );    
    mainApp.sessionStore.get( id, (error, session) => {
      if ( session ) {
        let photo = body.substring(idx+8);
        console.log( '200 - storing photo');
        var cacheData = {
          "status": "selfie_taken",
          "message": "Selfie taken",
          "photo": photo
        };
        session.sessionData = cacheData;
        console.log( session.sessionData );
        mainApp.sessionStore.set( id, session);  
        res.send();
      } else {
        console.log( `400 - Unknown state: ${id}` );
        res.status(400).json({'error': `Unknown state: ${id}`});      
      }
    });    
  }
}

///////////////////////////////////////////////////////////////////////////////////////
// this endpoint is called by the mobile when the user selects 'Use Photo'
mainApp.app.post('/api/issuer/selfie/:id', parser, async (req, res) => {
  var body = '';
  req.on('data', function (data) {
    body += data;
  });
  req.on('end', function () {
    mainApp.requestTrace( req );
    setUserPhoto( req.params.id, res, body );
  });  
})

///////////////////////////////////////////////////////////////////////////////////////
// this endpoint is called from the browser when the user is happy with 
// either a selfie or an uploaded picture
mainApp.app.post('/api/issuer/userphoto', parser, async (req, res) => {
  var body = '';
  req.on('data', function (data) {
    body += data;
  });
  req.on('end', function () {
    mainApp.requestTrace( req );
    setUserPhoto( req.session.id, res, body );
  });  
})

///////////////////////////////////////////////////////////////////////////////////////
// Return a Take Selfie request
mainApp.app.get('/api/issuer/selfie-request', async (req, res) => {
  mainApp.requestTrace( req );
  var id = req.session.id;
  mainApp.sessionStore.get( id, (error, session) => {
    if ( session ) {
      console.log( 'Resetting state');
      var cacheData = {
        "status": "request_created",
        "message": "Waiting for request to begin"
      };
      session.sessionData = cacheData;
      console.log( session.sessionData );
      mainApp.sessionStore.set( id, session);  
    }
  });    
  var resp = {
    id: req.session.id,
    url: `https://${req.hostname}/selfie.html?callbackUrl=https://${req.hostname}/api/issuer/selfie/${req.session.id}`,
    photo: '',
    status: "request_created",
    expiry: parseInt(Date.now() / 1000 + (60*5))
  };
  res.status(200).json(resp);   
})

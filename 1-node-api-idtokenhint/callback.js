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
var uuid = require('uuid');
var mainApp = require('./app.js');

var parser = bodyParser.urlencoded({ extended: false });

///////////////////////////////////////////////////////////////////////////////////////
//
/**
 * This method is called by the VC Request API when the user scans a QR code and presents a Verifiable Credential to the service
 */
mainApp.app.post('/api/request-callback', parser, async (req, res) => {
  var body = '';
  req.on('data', function (data) {
    body += data;
  });
  req.on('end', function () {
    mainApp.requestTrace( req );
    console.log( body );
    // the api-key is set at startup in app.js. If not present in callback, the call should be rejected
    if ( req.headers['api-key'] != mainApp.config["apiKey"] ) {
      res.status(401).json({ 'error': 'api-key wrong or missing' });  
      return; 
    }
    var callbackEvent = JSON.parse(body.toString());
    var cacheData;
    switch ( callbackEvent.requestStatus ) {
      // this callback signals that the request has been retrieved (QR code scanned, etc)
      case "request_retrieved":
        cacheData = {
          "status": callbackEvent.requestStatus,
          "message": "QR Code is scanned. Waiting for validation..."
        };
      break;
      // this callback signals that issuance of the VC was successful and the VC is now in the wallet
      case "issuance_successful":
        var cacheData = {
          "status" : callbackEvent.requestStatus,
          "message": "Credential successfully issued"
        };
      break;
      // this callback signals that issuance did not complete. It could be for technical reasons or that the user didn't accept it
      case "issuance_error":
        var cacheData = {
          "status" : callbackEvent.requestStatus,
          "message": callbackEvent.error.message,
          "payload": callbackEvent.error.code
        };
      break;
      // this callback signals that presentation has happened and VerifiedID have verified it
      case "presentation_verified":
        cacheData = {
          "status": callbackEvent.requestStatus,
          "message": "Presentation received",
          "payload": callbackEvent.verifiedCredentialsData,
          "subject": callbackEvent.subject,
          "presentationResponse": callbackEvent
        };
        // get details on VC, when it was issued, when it expires, etc
        if ( callbackEvent.receipt && callbackEvent.receipt.vp_token ) {
          var vp_token = '';
          if ( Array.isArray(callbackEvent.receipt.vp_token)) {
            vp_token = JSON.parse(base64url.decode(callbackEvent.receipt.vp_token[0].split(".")[1]));
          } else {
            vp_token = JSON.parse(base64url.decode(callbackEvent.receipt.vp_token.split(".")[1]));
          }
          var vc = JSON.parse(base64url.decode(vp_token.vp.verifiableCredential[0].split(".")[1]));
          cacheData.jti = vc.jti;  
        }
      break;
      case "presentation_error":
        var cacheData = {
          "status" : callbackEvent.requestStatus,
          "message": callbackEvent.error.message,
          "payload": callbackEvent.error.code
        };
      break;
      default:
        console.log( `400 - Unsupported requestStatus: ${callbackEvent.requestStatus}` );
        res.status(400).json({'error': `Unsupported requestStatus: ${callbackEvent.requestStatus}`});      
        return;
    }
    // store the session state so the UI can pick it up and progress
    mainApp.sessionStore.get( callbackEvent.state, (error, session) => {
      if ( session ) {
        session.sessionData = cacheData;
        mainApp.sessionStore.set( callbackEvent.state, session, (error) => {
          console.log( "200 - OK");
          res.send();
        });
      } else {
        console.log( `400 - Unknown state: ${callbackEvent.state}` );
        res.status(400).json({'error': `Unknown state: ${callbackEvent.state}`});      
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
mainApp.app.get('/api/request-status', async (req, res) => {
  var id = req.query.id;
  mainApp.requestTrace( req );
  mainApp.sessionStore.get( id, (error, session) => {
    if (session && session.sessionData) {
      console.log(`status: ${session.sessionData.status}, message: ${session.sessionData.message}`);
      if ( session.sessionData.status == "presentation_verified" ) {
        delete session.sessionData.presentationResponse; // browser don't need this
      }
      res.status(200).json(session.sessionData);   
    } else {
      console.log( `400 - Unknown state: ${id}` );
      res.status(400).json({'error': `Unknown state: ${id}`});      
    }
  })
})

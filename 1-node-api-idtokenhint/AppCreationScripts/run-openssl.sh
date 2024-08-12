#!/bin/bash
openssl genrsa -out ./aadappcert.pem 2048 
openssl req -new -key ./aadappcert.pem -out ./aadappcert.csr -subj "/CN=vcjavasample"
openssl x509 -req -days 365 -in ./aadappcert.csr -signkey ./aadappcert.pem -out ./aadappcert.crt

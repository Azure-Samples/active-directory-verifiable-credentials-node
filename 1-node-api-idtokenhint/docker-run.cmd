docker run --rm -it -p 8080:8080 ^
    -e CONFIGFILE=./config.json ^
    -e ISSUANCEFILE=./issuance_request_config.json ^
    -e PRESENTATIONFILE=./presentation_request_config.json ^
    node-aadvc-api-idtokenhint:latest
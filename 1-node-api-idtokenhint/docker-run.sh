#!/bin/bash

docker run --rm -it -p 8080:8080 \
 -e azTenantId='<tenantId>' \
 -e azClientId='<appId>' \
 -e azClientSecret='<secret>' \
 -e DidAuthority='did:web:...etc...' \
 -e clientName='Node.js Verified ID sample' \
 -e purpose='To prove you are an Verified ID expert' \
 -e CredentialManifest='https://verifiedid.did.msidentity.com/v1.0/tenants/...etc...' \
 -e CredentialType=VerifiedCredentialExpert \
 -e acceptedIssuers='did:web:...etc...' \
 -e issuancePinCodeLength=4 \
 -e sourcePhotoClaimName= \
 -e matchConfidenceThreshold=70 \
  node-api-idtokenhint:latest  

#!/bin/bash

# for access token
export azTenantId=<tenantId>
export azClientId=<appId>
export azClientSecret=<secret>
# export azCertificateName=
# export azCertificateLocation=
# export azCertificatePrivateKeyLocation=

# your tenant's DID
export DidAuthority=did:web:...your-domain....com
export clientName=Node.js Verified ID sample
export purpose=To prove you are an Verified ID expert

# for Issuance
export CredentialManifest=https://verifiedid.did.msidentity.com/v1.0/tenants/...etc...

# for Presentation (multiple acceptedIssuers can be separated by ;)
export CredentialType=VerifiedCredentialExpert
export acceptedIssuers=$DidAuthority
export issuancePinCodeLength=4

# for using FaceCheck in presentation requests
export sourcePhotoClaimName=
export matchConfidenceThreshold=70

echo Environment Variables loaded for tenant $azTenantId and type $CredentialType
echo run app via command "node app.js" of "npm run start"

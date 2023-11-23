@echo off

rem for access token
set azTenantId=<tenantId>
set azClientId=<appId>
set azClientSecret=<secret>
rem set azCertificateName=
rem set azCertificateLocation=
rem set azCertificatePrivateKeyLocation=

rem your tenant's DID
set DidAuthority=did:web:...your-domain....com
set clientName=Node.js Verified ID sample
set purpose=To prove you are an Verified ID expert

rem for Issuance
set CredentialManifest=https://verifiedid.did.msidentity.com/v1.0/tenants/...etc...

rem for Presentation (multiple acceptedIssuers can be separated by ;)
set CredentialType=VerifiedCredentialExpert
set acceptedIssuers=%DidAuthority%
set issuancePinCodeLength=4

rem for using FaceCheck in presentation requests
set sourcePhotoClaimName=
set matchConfidenceThreshold=70

echo Environment Variables loaded for tenant %azTenantId% and type %CredentialType%
echo run app via command "node app.js" of "npm run start"

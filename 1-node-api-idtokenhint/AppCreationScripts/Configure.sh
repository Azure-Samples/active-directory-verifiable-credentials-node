#!/bin/bash

# This bash script is intended to run on Mac/Linux and requires Azure-CLI
# https://docs.microsoft.com/en-us/cli/azure/install-azure-cli-macos
clientCertificate="secret"
while getopts "t:c:" flag; do
    case "${flag}" in
        t) tenantId=${OPTARG};;
        c) clientCertificate=${OPTARG};;
    esac
done

acct=$(az account show)
if [[ -z $acct ]]; then 
    if [[ -z $tenantId ]]; then az login; else az login -t $tenantId; fi
fi

appName="Verifiable Credentials VC Node sample"
appShortName="vcnodesample"

# get things we need
echo "Getting things..."
tenantId=$(az account show --query "tenantId" -o tsv)
tenantDomainName=$(az ad signed-in-user show --query 'userPrincipalName' -o tsv | cut -d '@' -f 2)

# create the app and the sp
echo "Creating the app and the sp"
appId=$(az ad app create --display-name "$appName" --identifier-uris "https://$tenantDomainName/$appShortName" --query "appId" -o tsv)
spId=$(az ad sp create --id $appId)

# set the current user as app owner
echo "Assigning owner"
userId=$(az ad signed-in-user show --query objectId -o tsv)
az ad app owner add --id $appId --owner-object-id $userId

clientSecret=""
certSubject=""
certThumbprint=""
certLocation=""

if [[ $clientCertificate != cert* ]]; then
    # create a client_secret
    echo "Generating client_secret"
    clientSecret=$(az ad app credential reset --id $appId --credential-description "Default" --query "password" -o tsv)
else
    echo "Generating self-signed certificate"
    certSubject="CN=$appShortName"
    openssl genrsa -out ./aadappcert.pem 2048 
    openssl req -new -key ./aadappcert.pem -out ./aadappcert.csr -subj "/$certSubject"
    openssl x509 -req -days 365 -in ./aadappcert.csr -signkey ./aadappcert.pem -out ./aadappcert.crt
    openssl x509 -in ./aadappcert.crt -fingerprint -sha1 | grep Fingerprint | cut -d '=' -f 2 > ./aadappcert.thumbprint
    certLocation="$(pwd)/aadappcert.pem"
    echo $certLocation
    certThumbprint=$(<./aadappcert.thumbprint)
    certThumbprint=${certThumbprint//[:]/} # remove the : in the thumbprint to make it just 40 hex chars
    echo $certThumbprint
    az ad app credential reset --id $appId --cert "@~/aadappcert.crt" --append
fi

# add permissions
echo "Assigning permissions"
vcsrAppId=$(az ad sp list --display-name "Verifiable Credentials Service Request" --query "[0].appId" -o tsv)
vcsrPermissionId=$(az ad sp list --display-name "Verifiable Credentials Service Request" --query "[0].appRoles" | grep id | cut -d "\"" -f 4)
perm=$(az ad app permission add --id $appId --api $vcsrAppId --api-permissions $vcsrPermissionId=Role)

# updating the sample config file with details of the app we created
echo "Updating ..\config.json"
sed -i -e "s/<YOUR-AAD-TENANDID>/$tenantId/g" ../config.json
sed -i -e "s/<YOUR-AAD-CLIENTID-FOR-KEYVAULT-ACCESS>/$appId/g" ../config.json
sed -i -e "s/<YOUR-AAD-CLIENTSECRET-FOR-KEYVAULT-ACCESS>/$clientSecret/g" ../config.json
sed -i -e "s/<YOUR-AAD-CERTNAME>/$certSubject/g" ../config.json
sed -i -e "s^<YOUR-AAD-CERTLOCATION>^$certLocation^g" ../config.json # alt delimiter as certLocation has / as path delimiter
sed -i -e "s/<YOUR-AAD-CERTTHUMBPRINT>/$certThumbprint/g" ../config.json

# creating report for the user
clientPortalUrl="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/CallAnAPI/appId/$appId"

echo ""
echo "IMPORTANT: Please follow the instructions below to complete a few manual step(s) in the Azure portal"
echo "- For '$appName'"
echo "  - Navigate to $clientPortalUrl"
echo "  - Click on 'Grant admin consent for $tenantDomainName' in the API Permissions page"

#!/bin/bash

# This bash script is intended to run on Mac/Linux and requires Azure-CLI
# https://docs.microsoft.com/en-us/cli/azure/install-azure-cli-macos

while getopts t: flag; do
    case "${flag}" in
        t) tenantId=${OPTARG};;
    esac
done

acct=$(az account show)
if [[ -z $acct ]]; then 
    if [[ -z $tenantId ]]; then az login; else az login -t $tenantId; fi
fi

appName="Verifiable Credentials VC Node sample"

# get thing we need
echo "Getting things..."
tenantId=$(az account show --query "tenantId" -o tsv)

# create the app and the sp
echo "Deleting app $appName"
appId=$(az ad sp list --display-name "$appName" --query "[0].appId" -o tsv)
if [ -z $appId ]; then 
    echo "App does not exist"
else
    az ad app delete --id $appId
    rm ./aadappcert*
fi


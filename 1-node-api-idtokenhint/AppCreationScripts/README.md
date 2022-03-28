# Registering the Azure Active Directory applications and updating the configuration files for this sample using PowerShell scripts

## Overview

### Quick summary

1. On Windows run PowerShell, navigate to the root of the cloned directory and then run the command:
   ```PowerShell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force
   ```
1. On Mac/Linux, open a terminal, navigate to the root of the cloned directory, and then run command `pwsh` to start Powershell Core. You do not need to .run the `Set-ExecutionPolicy` 
1. If you plan to use a client secret to authenticate the app (which is the default), you can skip this step. On Windows, if you plan to use app authentication via a self-signed certificate, you need to generate the certificate using `openssl` either using Windows Subsystem for Linux or on a Mac/Linux and then copy the files to your Windows computer. Please see details below and complete this step before continuing. 
1. Run the script to create your Azure AD application and configure the code of the sample application accordinly. (Other ways of running the scripts are described below)
   ```PowerShell
   cd AppCreationScripts
   ./Configure.ps1
   ```
1. Update the `config.json` with the CredentialManifest, IssuerAuthority and VerifierAuthority details
1. Run the solution via executing `run.cmd` on Windows or `run.sh` on Mac/Linux 

### Generating Self-Signed Certificate on Windows

If you plan to use a self-signed certificate for app authentication ***and*** you are using a Mac/Linux computer, the generation of certificates is all automatic and you don't need to read the rest of this section. If you are using a Windows computer, you need to perform a manually step ***after*** Configure.ps1 has completed to convert the certificate from `pfx` file format to `pem`. There are two ways of converting the pfx certificate:

If you have Windows Subsystem for Linux (WSL) enabled on your Windows computer, you can use it. Start WSL and navigate to the AppCreationScripts folder. If you don't have WSL, you need to copy the aadappcert.pfx file to a Mac/Linux computer, run the command and copy the aadappcert.pem file back to your Windows computer. 

```bash
openssl pkcs12 -in ./aadappcert.pfx -out ./aadappcert.pem
```

If you need to install openssl, you can do it via the below command

In WSL/Ubuntu

```bash
sudo apt-get install openssl
```

On a Mac, you install openssl via brew

```bash
brew install openssl
```

### More details

The following paragraphs:

- [Present the scripts](#presentation-of-the-scripts) and explain their [usage patterns](#usage-pattern-for-tests-and-devops-scenarios) for test and DevOps scenarios.
- Explain the [pre-requisites](#pre-requisites)
- Explain [different ways of running the scripts](#different-ways-of-running-the-scripts):

## Goal of the scripts

### Presentation of the scripts

This sample comes with two PowerShell scripts, which automate the creation of the Azure Active Directory applications, and the configuration of the code for this sample. Once you run them, you will only need to build the solution and you are good to test.

These scripts are:

- `Configure.ps1` which:
  - creates Azure AD applications and their related objects (permissions, dependencies, secrets/certificate),
  - changes the configuration file `config.json` in the sample code.
  - creates a summary file named `createdApps.html` in the folder from which you ran the script, and containing, for each Azure AD application it created:
    - the identifier of the application
    - the AppId of the application
    - the url of its registration in the [Azure portal](https://portal.azure.com).

- `Cleanup.ps1` which cleans-up the Azure AD objects created by `Configure.ps1`, including deleting the certificate files in the directory. Note that this script does not revert the changes done in the configuration files, though. You will need to undo the change from source control (from VSCode, or from the command line using, for instance, git reset).

## How to use the app creation scripts ?

### Pre-requisites

You must have Powershell installed on your machine. To install it, follow the documentation:
- [Windows](https://docs.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows?view=powershell-7.2)
- [Mac](https://docs.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-macos?view=powershell-7.2)
- [Linux](https://docs.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux?view=powershell-7.2)

### Install Az PowerShell modules
The scripts required PowerShell module Az. To install it, follow the documentation [here](https://docs.microsoft.com/en-us/powershell/azure/install-az-ps?view=azps-7.1.0). If you have installed it previously, make sure that you have the latest version by running Powershell command. The Configure.ps1 script may give an error if you have an old version. 

```powershell
Update-Module -Name Az
```
If you do need to run `Update-Module` on Mac/Linux, you need to exit the Powershell shell `pwsh` and enter it again.

### openssl on Mac/Linux

If you are running the `Configure.ps1` script on a Mac/Linux, and you plan to use the option of authenticating as the app using a client certificate, you need to install `openssl` on your computer. How you do this varies with what Linux distro you are using, but on Ubunto, you install openssl by running this in the terminal window

```bash
sudo apt-get install openssl
```

On a Mac, you install openssl via brew

```bash
brew install openssl
```

### Different ways of running the scripts

Using the parameters, the script can be run in the following different ways. Depending on if you haven't signed in from the powershell prompt yet, you will be required to do an interactive signin. If you already have signed in, the script will execute in the current context. You can check if you have a current context via the `Get-AzContext` powershell command. This will show which Azure AD tenant you are currently signed in to. If this is the wrong Azure AD tenant, you can clear the current context with the `Clear-AzContext`. 

If you don't want to sign in every time you execute a script, you can to this via running the following

```powershell
$tenantId = "yourTenantIdGuid"
Connect-AzConnect -tenantId $tenantId
```

#### Option 1

Running the script without any parameters will use the current context, if it exist, or ask the user to sign in interactively.

```powershell
.\Configure.ps1
```

#### Option 2 - specify tenant

Running the script and specifying the tenantId will check that the current is for the specified Azure AD tenant and exit if it is not. If an interactive sign in is needed, it will be for the Azure AD tenant specified in the parameter. Specifying the tenant explicitly avoids accidentally running the script in the wrong tenant.

```powershell
.\Configure.ps1 -tenantId $tenantId
```

#### Option 3 - specify type of app credentials

The default behaviour of the `Configure.ps1` script is to register the app and create a `client secret` as it's credentials. This allows the sample app to authenticate using a client_id and a client_secret. If you instead prefer that the app authenticates via a `client certificate`, you can let the script generate a self-signed certificate and upload it to the app registration. There is also the possibility of creating both a client secret

```powershell
.\Configure.ps1 -ClientCertificate
```

```powershell
.\Configure.ps1 -ClientCertificate -ClientSecret
```

If you use the `-ClientCertificate` option, on Windows, the script will create a self-signed certificate in the user certificate store under Personal\Certificates with the subject `CN=vcaspnetcoresample`. On Mac/Linux, the self-signed certificate will be three files named appaadcert.pem, appaadcert.csr and addaadcert.csr. The `Cleanup.ps1` script will remove the certificate from the certificate store on Windows and delete the files on Mac/Linux.

#### Option 4 - Cleanup

This option is if you need cleanup after you are done testing or if you need to re-run the script. The `-ClientCertificate` and `-ClientSecret` parameters are just there for reference to show how it could look.
 
```PowerShell
$tenantId = "yourTenantIdGuid"
. .\Cleanup.ps1 -TenantId $tenantId
. .\Configure.ps1 -TenantId $tenantId -ClientCertificate -ClientSecret
```

### Azure CLI versions of the scripts

If you are using a Mac/Linux and have [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed, you can use the bash scripts instead of installing Powershell for Mac/Linux. The script `Configure.sh` works the same way as `Configure.ps1`.

#### Option 1

```bash
tenantId = "yourTenantIdGuid"
./Configure.sh -t $tenantId
```

#### Option 2 - specify tenant

```bash
tenantId = "yourTenantIdGuid"
./Configure.sh -t $tenantId
```

#### Option 3 - specify type of app credentials

```bash
tenantId = "yourTenantIdGuid"
./Configure.sh -t $tenantId -c cert
```

```bash
./Configure.sh -t $tenantId -c secret
```

#### Option 4 - Cleanup

```bash
tenantId = "yourTenantIdGuid"
./Cleanup.sh -t $tenantId
```

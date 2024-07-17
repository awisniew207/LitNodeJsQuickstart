const { LitNodeClient } = require('@lit-protocol/lit-node-client');
const { encryptFile, decryptToString } = require('@lit-protocol/encryption');
const { LitAccessControlConditionResource, LitAbility, createSiweMessageWithRecaps, generateAuthSig } = require('@lit-protocol/auth-helpers');
const { ethers } = require('ethers');
const fs = require('fs').promises;

  // More information about the available Lit Networks: https://developer.litprotocol.com/category/networks
const runall = async() => {
const connect = async() => {
const litNodeClient = new LitNodeClient({
    litNetwork: 'datil-dev',
    debug: false,
  });
  await litNodeClient.connect();
  return litNodeClient;
}
const litNodeClient = await connect();

const ethersWallet = new ethers.Wallet('69b6b0608ab002dbf73469588e6d4730952b570670753dd32c50a09869778c0e')

  const generateSessionSigs = async (address, litClient, state, signer) => {
    // Define the authNeededCallback function
    const authNeededCallback = async (authCallbackParams) => {
      if (!authCallbackParams.uri) {
        throw new Error('uri is required');
      }
      if (!authCallbackParams.expiration) {
        throw new Error('expiration is required');
      }

      if (!authCallbackParams.resourceAbilityRequests) {
        throw new Error('resourceAbilityRequests is required');
      }
      // Create the SIWE message
      const toSign = await createSiweMessageWithRecaps({
        uri: authCallbackParams.uri,
        expiration: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
        resources: authCallbackParams.resourceAbilityRequests,
        walletAddress: address,
        nonce: state.nonce,
        litNodeClient: litClient,
      });
      // Generate the authSig
      const authSig = await generateAuthSig({
        signer: signer,
        toSign,
      });
      state.authSig = authSig;
      return authSig;
    };
    
    // Define the Lit resource
    const litResource = new LitAccessControlConditionResource('*');
    console.log('here is the litresource', litResource);
    // Get the session signatures
    const sessionSigs = await litClient.getSessionSigs({
      chain: 'baseSepolia',
      resourceAbilityRequests: [
        {
          resource: litResource,
          ability: LitAbility.AccessControlConditionDecryption,
        },
      ],
      authNeededCallback,
      // capacityDelegationAuthSig
    });
    console.log('got sessionSigs', { ...state, sessionSigs });
    return { ...state, sessionSigs };
  };
  const state = {}
  const sessionSigs = await generateSessionSigs(ethersWallet.address, litNodeClient, state, ethersWallet);
  console.log("state", state);

  const encryptFileWithLit = async (litClient, chain, file, accessControlConditions) => {
    try {
      const { ciphertext, dataToEncryptHash } = await encryptFile(
        {
          file,
          chain,
          unifiedAccessControlConditions: accessControlConditions
        },
        litClient
      );
  
      return {
        ciphertext,
        dataToEncryptHash
      };
    } catch (error) {
      console.error('Error encrypting file:', error);
      throw error; // Rethrow the error to be handled by the caller if needed
    }
  };

  const decryptFileWithLit = async (litClient, chain, ciphertext, encryptedFileHash, sessionSigs, accessControlConditions) => {
    //console.log("AuthSig here", sessionSigs.authSig);
    return decryptToString(
      {
        //authSig: sessionSigs.authSig,
        ciphertext,
        dataToEncryptHash: encryptedFileHash,
        chain,
        sessionSigs,
        accessControlConditions: [
          {
            contractAddress: "",
            standardContractType: "",
            chain: "ethereum",
            method: "",
            parameters: [":userAddress"],
            returnValueTest: {
              comparator: "=",
              value: ethersWallet.address,
            },
          },
        ],
      },
      litClient
    );
  };

  const hasReadAllowanceOnIPNFT = (chain) => ({
    conditionType: 'evmContract',
    contractAddress: '0x0000000000000000000000000000000000000000', // Dummy address for debugging
    chain,
    functionName: 'canRead',
    functionParams: [':userAddress', '1'], // Dummy tokenId for debugging
    functionAbi: {
      inputs: [
        {
          internalType: 'address',
          name: 'reader',
          type: 'address',
        },
        {
          internalType: 'uint256',
          name: 'tokenId',
          type: 'uint256',
        },
      ],
      name: 'canRead',
      outputs: [
        {
          internalType: 'bool',
          name: '',
          type: 'bool',
        },
      ],
      stateMutability: 'view',
      type: 'function',
    },
    returnValueTest: {
      key: '',
      comparator: '=',
      value: 'true',
    },
  });
  try {
    const filePath = './encme.txt';
    const fileContent = await fs.readFile(filePath);
    const fileBlob = new Blob([fileContent]);
    const { ciphertext, dataToEncryptHash } = await encryptFileWithLit(litNodeClient, 'baseSepolia', fileBlob, [hasReadAllowanceOnIPNFT('baseSepolia')]);
    console.log("SessionSigs:", sessionSigs);
    const dec = await decryptFileWithLit(litNodeClient, 'baseSepolia', ciphertext, dataToEncryptHash, sessionSigs, [hasReadAllowanceOnIPNFT('baseSepolia')]);
    console.log(ciphertext)
  } catch (error) {
    console.error('Error in main function:', error);
  }
};
runall();
const ethers = require('ethers');
const { LitAuthClient } = require('@lit-protocol/lit-auth-client');
const { LitNodeClient } = require('@lit-protocol/lit-node-client');
const { AuthMethodScope, ProviderType } = require('@lit-protocol/constants');
const { PKPEthersWallet } = require('@lit-protocol/pkp-ethers');
const { LitAbility, LitPKPResource, LitActionResource, createSiweMessageWithRecaps, generateAuthSig } = require('@lit-protocol/auth-helpers');
const { setTimeout } = require("timers/promises");

const LIT_NETWORK = 'datil-dev';
const RELAYER_LIT_API = 'does not matter';
const DOMAIN = 'localhost';
const ORIGIN = 'http://localhost:3000';

async function work() {
  const authUserKeys = ethers.Wallet.createRandom();  // Similar to provider instance of getting a wallet
  const ethersSigner = new ethers.Wallet(authUserKeys.privateKey, new ethers.JsonRpcProvider('https://vesuvius-rpc.litprotocol.com')); // Connect wallet through Lit RPC for signing

  const litNodeClient = new LitNodeClient({
    alertWhenUnauthorized: false,
    litNetwork: LIT_NETWORK,
    debug: false,
  });
  await litNodeClient.connect(); // Connect to Lit Network

  const litAuthClient = new LitAuthClient({ // Established authorized connection through Lit login
    litRelayConfig: {
      relayApiKey: RELAYER_LIT_API,
      debug: false,
    },
    litNodeClient,
  });

  const provider = litAuthClient.initProvider(ProviderType.EthWallet, { domain: DOMAIN, origin: ORIGIN }); // Initialize an EthWallet provider 

  const genAuthSig = async () => { // needs {expiration, uri}
    const toSign = await createSiweMessageWithRecaps({
      walletAddress: ethersSigner.address,
      resources: [
        {
          resource: new LitPKPResource('*'),
          ability: LitAbility.PKPSigning,
        },
      ],
      litNodeClient,
      domain: DOMAIN,
    });
    const authSig = await generateAuthSig({ signer: ethersSigner, toSign });
    return authSig;
  };

  ethersSigner.signMessage = await genAuthSig();

  const authMethod = {
    authMethodType: 1,
    accessToken: JSON.stringify(ethersSigner.signMessage),
  };

  console.log("AuthMethod:", authMethod);
  const newPKP = await mintPKP(provider, authMethod);

  const litActionSig = await signWithLitAction(litNodeClient, authMethod, provider, newPKP);
  console.log("signWithLitAction signatures: ", litActionSig);

  const pkpWallet = await pkpWalletInit(litNodeClient, authMethod, newPKP);

  console.log("Line 69: PKPEthersWallet.signMessage");
  const res = await pkpWallet.signMessage('Hello VaultLayer! Chain-Abstraction for 1 click Bitcoin DeFi');
  console.log('signMessage res:', res);

  await litNodeClient.disconnect();
  return "hello";
}

const pkpWalletInit = async (litNodeClient, authMethod, pkp) => {

  const authNeededCallback = async (params) => {
    const response = await litNodeClient.signSessionKey({
      statement: params.statement,
      authMethods: [authMethod],
      expiration: params.expiration,
      resources: params.resources,
      chainId: 1,
      pkpPublicKey: pkp.publicKey,
    });
    return response.authSig;
  };

  try {
    const authContext = {
      client: litNodeClient,
      getSessionSigsProps: {
        chain: 'ethereum',
        expiration: new Date(Date.now() + 60_000 * 60).toISOString(),
        resourceAbilityRequests: [
          {
            resource: new LitActionResource("*"),
            ability: LitAbility.PKPSigning,
          },
        ],
        authNeededCallback,
      },
      authMethods: [authMethod]
    };
    const pkpWallet = new PKPEthersWallet({
      authContext,
      litNodeClient,
      pkpPubKey: pkp.publicKey
    });
    await pkpWallet.init();
    return pkpWallet;
  } catch (e) {
    console.error('pkpWallet error', e);
  }
};

async function mintPKP(provider, authMethod) {
  const options = {
    permittedAuthMethodScopes: [[AuthMethodScope.SignAnything]],
  };
  const mintTxHash = await provider.mintPKPThroughRelayer(authMethod, options);
  await setTimeout(2000);
  const response = await provider.relay.pollRequestUntilTerminalState(mintTxHash);

  if (response.status !== 'Succeeded') {
    throw new Error('PKP Failed to Mint or Fetch');
  }

  return {
    tokenId: response.pkpTokenId,
    publicKey: response.pkpPublicKey,
    ethAddress: response.pkpEthAddress,
  };
}

const signWithLitAction = async (litNodeClient, authMethod, provider, pkp) => {
  const authNeededCallback = async (params) => {
    console.log("Line 138: LitNodeClient.signSessionKey")
    const response = await litNodeClient.signSessionKey({
      sessionKey: params.sessionKey,
      statement: params.statement || "Hello",
      authMethods: [authMethod],
      expiration: params.expiration,
      resources: params.resources,
      chainId: 1,
      pkpPublicKey: pkp.publicKey,
    });
    return response.authSig;
  };

  try {
    // Get session signatures for the given PKP public key and auth method
    const sessionSigs = await provider.getSessionSigs({
      pkpPublicKey: pkp.publicKey,
      authMethod,
      sessionSigsParams: {
        chain: 'ethereum',
        resourceAbilityRequests: [{
          resource: new LitActionResource("*"),
          ability: LitAbility.PKPSigning,
        },
        {
          resource: new LitActionResource("*"),
          ability: LitAbility.LitActionExecution,
        },
        ],
        authNeededCallback
      },
    });
    console.log('signWithLitAction getSessionSigs', sessionSigs);

    const { signatures } = await litNodeClient.executeJs({
      code: litActionCode,
      sessionSigs,
      jsParams: {
        toSign: hashForSig,
        publicKey: pkpPublicKey,
        sigName: "sig1",
      },
    });
    return signatures;
  } catch (e) {
    console.error('signWithLitAction error', e);
  }
};

work()
  .then((pkpWallet) => {
    console.log('pkpWallet connected successfully:', pkpWallet);

  })
  .catch((error) => {
    console.error('Error creating pkpWallet:', error);
  });

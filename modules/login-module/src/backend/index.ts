import * as sdk from 'botpress/sdk';
import { Request, Router } from 'express';
import * as oauth2 from 'simple-oauth2';
import { wrapper, serverError } from './error-handlers';
import { retrieveConfig, updateSSODetails } from './helpers';

let baseCallbackUrl, botIdx, oauth2Instance, authTokenObject;

interface ReqWithSession extends Request {
  session: any;
  body: any;
  params: any;
}

const authInitialise = async (req: ReqWithSession, res) => {
  try {
    authTokenObject = null;
    const credentials = retrieveConfig(req.params);
    const callbackURL = `${baseCallbackUrl}/api/v1/bots/${botIdx}/mod/login-module/callback`;
    // Initialise Oauth
    oauth2Instance = oauth2.create(credentials);
    const authorizationUri = oauth2Instance.authorizationCode.authorizeURL({
      redirect_uri: callbackURL,
    });

    res.status(200).json(authorizationUri);
  } catch(e) {
    res.status(400).send('Error Initialise');
  }

}

async function callbackAuth(req: any, res, next) {
  try {
    const code = req.query['code'];
    const callbackURL = `${baseCallbackUrl}/api/v1/bots/${botIdx}/mod/login-module/callback`;
    const tokenConfig = {
      code,
      redirect_uri: callbackURL,
    };

    const result = await oauth2Instance.authorizationCode.getToken(tokenConfig);
    const accessTokenResponse = oauth2Instance.accessToken.create(result);
    authTokenObject = accessTokenResponse.token;

    res.send(`<div> Authentication success!! </div><script>window.setTimeout(window.close, 1500)</script>`)
  } catch(e) {
    console.log(e);
    res.send('Error');
  }
};

async function getAccessToken(req, res, next) {
  res.status(200).send(authTokenObject);
} 

const onServerStarted = async (bp: typeof sdk) => {}

// Register Routes Here
const onServerReady = async (bp: typeof sdk) => {
  const router = bp.http.createRouterForBot('login-module', { checkAuthentication: false }) as Router;
  router.get('/auth', wrapper(authInitialise));
  router.get('/callback', wrapper(callbackAuth));
  router.get('/updateSSO', wrapper(async (req, res, next) => {
    authTokenObject = null;
    await updateSSODetails(req, res, next);
  }));
  router.get('/getToken', wrapper(getAccessToken));
  router.use(serverError); // Server Error Will be Caught Here
}

const onBotMount = async (bp: typeof sdk, botId) => {
  //@Initialise Bot Params
  botIdx = botId;  
  //@ts-ignore
  baseCallbackUrl = process.env.EXTERNAL_URL || `http://${process.HOST}:${process.PORT}`;
  console.log(botId, baseCallbackUrl);
}

const entryPoint: sdk.ModuleEntryPoint = {
  onServerStarted,
  onServerReady,
  onBotMount,
  definition: {
    name: 'login-module',
    fullName: 'SSO login Module',
    homepage: 'https://botpress.io',
    noInterface: true
  }
}

export default entryPoint
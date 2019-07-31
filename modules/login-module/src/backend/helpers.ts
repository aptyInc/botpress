import { APP, ISSO_Config } from './types'

export const getMergedConfig = (app: APP, config): ISSO_Config => {
  let appConfig: ISSO_Config
  switch (app) {
    case 'salesforce':
      appConfig = {
        client: {
          id: config.clientId,
          secret: config.clientSecret
        },
        auth: {
          tokenHost: config.tokenHost,
          tokenPath: '/services/oauth2/token',
          authorizePath: '/services/oauth2/authorize'
        }
      }
      break
    default: appConfig = defaultConfig  // No Details Found
  }
  return appConfig
}

export const defaultConfig: ISSO_Config = {
  client: {
    id: '3MVG9YDQS5WtC11oX_sE6lvLOcbyrVPC3sQc6L.miIoo_LCGXSX1dtaBjvpJ9TY7xxLepKLoQ.bU5V_ycM7_m',
    secret: 'AAE8A1E73172ABC5599BD80E606B9964D6DEBA63EBE1E1314006A4DC1C2535D8'
  },
  auth: {
    tokenHost: 'https://letznav-dev-ed.my.salesforce.com',
    tokenPath: '/services/oauth2/token',
    authorizePath: '/services/oauth2/authorize'
  }
}

export const retrieveConfig = (hostConfig: any): ISSO_Config => {
  const isParamsExist = hostConfig.clientId && hostConfig.clientSecret
  if (isParamsExist) {
    return getMergedConfig(hostConfig.app, hostConfig)
  } else {
    return defaultConfig
  }
}

export const updateSSODetails = async (req, res, next) => {
  const params = req.query
  defaultConfig.client.id = params['clientId']
  defaultConfig.client.secret = params['clientSecret']
  defaultConfig.auth.tokenHost = params['tokenHost']
  res.status(200).send('Success')
}

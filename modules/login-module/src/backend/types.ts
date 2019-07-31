export type APP = 'salesforce' | 'nasa' | 'workday';

export interface ISSO_Config {
    client: {
        id: string;
        secret: string;
    };
    auth: {
        tokenHost: string;
        tokenPath: string;
        authorizePath: string;
    }
}
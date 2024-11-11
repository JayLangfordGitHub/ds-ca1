import { 
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerEvent,
  PolicyDocument,
  APIGatewayProxyEvent,
  StatementEffect,
} from "aws-lambda";
import axios from "axios";
import jwt from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";
import { marshall } from "@aws-sdk/util-dynamodb";
import { Song, SongArtist } from "./types";

export type CookieMap = { [key: string]: string } | undefined;
export type JwtToken = { sub: string; email: string } | null;
export type Jwk = {
  keys: {
    alg: string;
    e: string;
    kid: string;
    kty: "RSA";
    n: string;
    use: string;
  }[];
};

// Parses cookies from the request headers
export const parseCookies = (
  event: APIGatewayRequestAuthorizerEvent | APIGatewayProxyEvent
): CookieMap => {
  if (!event.headers || !event.headers.Cookie) {
    return undefined;
  }
  const cookiesStr = event.headers.Cookie;
  const cookiesArr = cookiesStr.split(";");

  const cookieMap: CookieMap = {};

  for (let cookie of cookiesArr) {
    const cookieSplit = cookie.trim().split("=");
    cookieMap[cookieSplit[0]] = cookieSplit[1];
  }

  return cookieMap;
};

// Verifies the JWT token using the Cognito JWKs
export const verifyToken = async (
  token: string,
  userPoolId: string | undefined,
  region: string
): Promise<JwtToken> => {
  try {
    const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
    const { data }: { data: Jwk } = await axios.get(url);
    const pem = jwkToPem(data.keys[0]);

    return jwt.verify(token, pem, { algorithms: ["RS256"] }) as JwtToken;
  } catch (err) {
    console.log(err);
    return null;
  }
};

// Creates an IAM policy document to allow or deny access
export const createPolicy = (
  event: APIGatewayAuthorizerEvent,
  effect: StatementEffect
): PolicyDocument => {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: effect,
        Action: "execute-api:Invoke",
        Resource: [event.methodArn],
      },
    ],
  };
};

// Function to generate a DynamoDB PutRequest item
export const generateItem = (entity: Song | SongArtist) => {
  return {
    PutRequest: {
      Item: marshall(entity),
    },
  };
};

// Function to generate a batch of DynamoDB PutRequests
export const generateBatch = (data: (Song | SongArtist)[]) => {
  return data.map((e) => {
    return generateItem(e);
  });
};
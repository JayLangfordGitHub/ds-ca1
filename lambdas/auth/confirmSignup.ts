import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ConfirmSignUpBody } from "../../shared/types";
import { CognitoIdentityProviderClient, ConfirmSignUpCommand } from "@aws-sdk/client-cognito-identity-provider";
import Ajv from "ajv";
import schema from "../../shared/types.schema.json";

const ajv = new Ajv();
const isValidBodyParams = ajv.compile(schema.definitions["ConfirmSignUpBody"] || {});
const client = new CognitoIdentityProviderClient({ region: process.env.REGION });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : undefined;
    if (!isValidBodyParams(body)) {
      return { statusCode: 400, body: JSON.stringify({ message: "Invalid confirm signup data" }) };
    }
    
    const { username, code } = body as ConfirmSignUpBody;
    
    // Map the properties to match the expected input for ConfirmSignUpCommand
    const command = new ConfirmSignUpCommand({
        ClientId: process.env.CLIENT_ID!,
        Username: username,
        ConfirmationCode: code,
      });
    
    await client.send(command);
    
    return { statusCode: 200, body: JSON.stringify({ message: "Account confirmed successfully" }) };
  } catch (error: any) {
    console.error("Error confirming signup:", error);
    return { statusCode: 500, body: JSON.stringify({ message: error.message }) };
  }
};
import { APIGatewayProxyHandlerV2 } from "aws-lambda";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": "token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
    },
    body: JSON.stringify({ message: "Signout successful" }),
  };
};
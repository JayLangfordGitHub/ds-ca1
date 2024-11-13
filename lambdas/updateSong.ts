import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { TranslateClient, TranslateTextCommand } from "@aws-sdk/client-translate";
import Ajv from "ajv";
import schema from "../shared/types.schema.json";

const ajv = new Ajv();
type SongProperties = keyof typeof schema.definitions.Song.properties;

const validateField = (fieldName: SongProperties, value: any) => {
    const fieldSchema = schema.definitions.Song.properties[fieldName];
    const validate = ajv.compile(fieldSchema);
    return validate(value);
};

const ddbDocClient = createDDbDocClient();
const translateClient = new TranslateClient({ region: process.env.REGION });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const songId = event.pathParameters?.songId;
    const language = event.queryStringParameters?.language;
    const body = event.body ? JSON.parse(event.body) : undefined;

    if (!songId) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Missing song ID in path parameters" }),
      };
    }

    if (language) {
      const songData = await ddbDocClient.send(
        new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { id: Number(songId) },
        })
      );

      if (!songData.Item) {
        return {
          statusCode: 404,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Song not found" }),
        };
      }

      const song = songData.Item;
      const translations = song.translationCache || {};

      if (!translations[language]) {
        const translationResult = await translateClient.send(
          new TranslateTextCommand({
            Text: song.title,
            SourceLanguageCode: "en",
            TargetLanguageCode: language,
          })
        );

        const translatedTitle = translationResult.TranslatedText || "";
        const updatedTranslations = { ...translations, [language]: { title: translatedTitle } };

        await ddbDocClient.send(
          new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { id: Number(songId) },
            UpdateExpression: "set translationCache = :translations",
            ExpressionAttributeValues: { ":translations": updatedTranslations },
            ReturnValues: "UPDATED_NEW",
          })
        );

        song.translationCache = updatedTranslations;
      }

      const responseSong = { ...song, title: song.translationCache[language]?.title || song.title };
      return { statusCode: 200, body: JSON.stringify({ data: responseSong }) };
    }

    if (body) {
      const updateExpressionParts = [];
      const expressionAttributeValues: { [key: string]: any } = {};
      const expressionAttributeNames: { [key: string]: string } = {};

      for (const key in body) {
        if (body.hasOwnProperty(key) && schema.definitions.Song.properties[key as SongProperties]) {
          const isValid = validateField(key as SongProperties, body[key]);
          if (!isValid) {
            return {
              statusCode: 400,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ message: `Invalid value for field ${key}` }),
            };
          }
          const attributeName = `#${key}`;
          const attributeValue = `:${key}`;
          updateExpressionParts.push(`${attributeName} = ${attributeValue}`);
          expressionAttributeValues[attributeValue] = body[key];
          expressionAttributeNames[attributeName] = key;
        }
      }

      if (updateExpressionParts.length === 0) {
        return {
          statusCode: 400,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "No valid fields to update" }),
        };
      }

      const updateExpression = `SET ${updateExpressionParts.join(", ")}`;

      const commandOutput = await ddbDocClient.send(
        new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: { id: Number(songId) },
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ExpressionAttributeNames: expressionAttributeNames,
          ReturnValues: "ALL_NEW",
        })
      );

      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: `Song with ID ${songId} updated successfully`, updatedAttributes: commandOutput.Attributes }),
      };
    } else {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Invalid request body" }),
      };
    }
  } catch (error: any) {
    console.log(JSON.stringify(error));
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshallOptions = { wrapNumbers: false };
  return DynamoDBDocumentClient.from(ddbClient, { marshallOptions, unmarshallOptions });
}
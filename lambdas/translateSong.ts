import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
const translateClient = new TranslateClient({ region: process.env.REGION });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const { songId } = event.pathParameters || {};
    const language = event.queryStringParameters?.language;

    if (!songId) {
      return { statusCode: 400, body: JSON.stringify({ message: "songId is required" }) };
    }

    const songData = await ddbClient.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { id: parseInt(songId) },
    }));

    if (!songData.Item) {
      return { statusCode: 404, body: JSON.stringify({ message: "song not found" }) };
    }

    const song = songData.Item;

    if (!language) {
      return { statusCode: 200, body: JSON.stringify({ data: song }) };
    }

    // Check if translation already exists in cache
    const translations = song.translationCache || {};
    if (!translations[language]) {
      const translationResult = await translateClient.send(
        new TranslateTextCommand({
          Text: song.title,
          SourceLanguageCode: 'en', 
          TargetLanguageCode: language,
        })
      );

      const translatedTitle = translationResult.TranslatedText || '';
      const updatedTranslations = { ...translations, [language]: { title: translatedTitle } };
      await ddbClient.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { id: parseInt(songId) },
        UpdateExpression: "set translationCache = :translations",
        ExpressionAttributeValues: { ":translations": updatedTranslations },
        ReturnValues: "UPDATED_NEW"
      }));

      song.translationCache = updatedTranslations;
    }

    const responseSong = { ...song, title: song.translationCache[language]?.title || song.title };

    return { statusCode: 200, body: JSON.stringify({ data: responseSong }) };

  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ message: "error translating song", error }) };
  }
};
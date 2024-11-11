import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as apig from "aws-cdk-lib/aws-apigateway";
import * as custom from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { UserPool } from "aws-cdk-lib/aws-cognito";
import { generateBatch } from "../shared/util";
import { songs, songArtists } from "../seed/songs";

export class RestAPIStack extends cdk.Stack {
  private userPoolId: string;
  private userPoolClientId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Setup Cognito User Pool and App Client
    const userPool = new UserPool(this, "UserPool", {
      signInAliases: { username: true, email: true },
      selfSignUpEnabled: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const appClient = userPool.addClient("AppClient", {
      authFlows: { userPassword: true },
    });
    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = appClient.userPoolClientId;

    // Setup DynamoDB tables for Songs and SongArtists
    const songsTable = new dynamodb.Table(this, "SongsTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "id", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Songs",
    });
    const songArtistsTable = new dynamodb.Table(this, "SongArtistsTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "songId", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "artistName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "SongArtists",
    });
    songArtistsTable.addLocalSecondaryIndex({
      indexName: "roleIx",
      sortKey: { name: "roleName", type: dynamodb.AttributeType.STRING },
    });

    // Initialize songs and song artists data in DynamoDB
    new custom.AwsCustomResource(this, "songsddbInitData", {
      onCreate: {
        service: "DynamoDB",
        action: "batchWriteItem",
        parameters: {
          RequestItems: {
            [songsTable.tableName]: generateBatch(songs),
            [songArtistsTable.tableName]: generateBatch(songArtists),
          },
        },
        physicalResourceId: custom.PhysicalResourceId.of("songsddbInitData"),
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [songsTable.tableArn, songArtistsTable.tableArn],
      }),
    });

    // Auth API (for signup and signin)
    const authApi = new apig.RestApi(this, "AuthServiceApi", {
      description: "Authentication Service RestApi",
      endpointTypes: [apig.EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        allowOrigins: apig.Cors.ALL_ORIGINS,
      },
    });
    this.addAuthRoute(authApi, "signup", "POST", "SignupFn", "signup.ts");
    this.addAuthRoute(authApi, "signin", "POST", "SigninFn", "signin.ts");

    // Authoriser Lambda Function
    const authorizerFn = new lambdanode.NodejsFunction(this, "AuthorizerFn", {
      entry: `${__dirname}/../lambdas/auth/authoriser.ts`,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 128,
      environment: {
        USER_POOL_ID: this.userPoolId,
        REGION: cdk.Aws.REGION,
      },
    });

    // Custom Request Authoriser
    const requestAuthorizer = new apig.RequestAuthorizer(this, "RequestAuthorizer", {
      identitySources: [apig.IdentitySource.header("cookie")],
      handler: authorizerFn,
      resultsCacheTtl: cdk.Duration.seconds(0),
    });

    // Rest API for Songs with protected and public endpoints
    const api = new apig.RestApi(this, "RestAPI", {
      description: "Songs API",
      deployOptions: {
        stageName: "dev",
      },
      defaultCorsPreflightOptions: {
        allowHeaders: ["Content-Type", "X-Amz-Date"],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        allowCredentials: true,
        allowOrigins: ["*"],
      },
    });

    // Lambda functions for Songs API
    const getSongByIdFn = this.createLambdaFunction("GetSongByIdFn", "getSongById.ts", songsTable.tableName);
    const getAllSongsFn = this.createLambdaFunction("GetAllSongsFn", "getAllSongs.ts", songsTable.tableName);
    const newSongFn = this.createLambdaFunction("AddSongFn", "addSong.ts", songsTable.tableName);
    const deleteSongFn = this.createLambdaFunction("DeleteSongFn", "deleteSongs.ts", songsTable.tableName);
    const getSongArtistFn = this.createLambdaFunction("GetSongArtistFn", "getSongArtist.ts", songArtistsTable.tableName);

    // Permissions
    songsTable.grantReadData(getSongByIdFn);
    songsTable.grantReadData(getAllSongsFn);
    songsTable.grantReadWriteData(newSongFn);
    songsTable.grantReadWriteData(deleteSongFn);
    songArtistsTable.grantReadData(getSongArtistFn);

    // API Routes for Songs
    const songsEndpoint = api.root.addResource("songs");
    songsEndpoint.addMethod("GET", new apig.LambdaIntegration(getAllSongsFn), {
      authorizer: requestAuthorizer,
      authorizationType: apig.AuthorizationType.CUSTOM,
    });
    songsEndpoint.addMethod("POST", new apig.LambdaIntegration(newSongFn));

    const songEndpoint = songsEndpoint.addResource("{songId}");
    songEndpoint.addMethod("GET", new apig.LambdaIntegration(getSongByIdFn), {
      authorizer: requestAuthorizer,
      authorizationType: apig.AuthorizationType.CUSTOM,
    });
    songEndpoint.addMethod("DELETE", new apig.LambdaIntegration(deleteSongFn), {
      authorizer: requestAuthorizer,
      authorizationType: apig.AuthorizationType.CUSTOM,
    });

    const songArtistEndpoint = songsEndpoint.addResource("artists");
    songArtistEndpoint.addMethod("GET", new apig.LambdaIntegration(getSongArtistFn));
  }

  // Helper method to create Lambda functions
  private createLambdaFunction(fnName: string, entryFile: string, tableName: string) {
    return new lambdanode.NodejsFunction(this, fnName, {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/${entryFile}`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: tableName,
        REGION: cdk.Aws.REGION,
      },
    });
  }

  // Helper method to add Auth routes
  private addAuthRoute(
    api: apig.RestApi,
    resourceName: string,
    method: string,
    fnName: string,
    fnEntry: string
  ): void {
    const fn = new lambdanode.NodejsFunction(this, fnName, {
      entry: `${__dirname}/../lambdas/auth/${fnEntry}`,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 128,
      environment: {
        USER_POOL_ID: this.userPoolId,
        CLIENT_ID: this.userPoolClientId,
        REGION: cdk.Aws.REGION,
      },
    });
    const resource = api.root.addResource(resourceName);
    resource.addMethod(method, new apig.LambdaIntegration(fn));
  }
}
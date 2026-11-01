import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { CreateBucketCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

import { waitUntilReady } from "./processes";

const run = promisify(execFile);

/** Pinned: LocalStack, the standard local stand-in for Amazon's services, S3 only. */
const LOCALSTACK_IMAGE = "localstack/localstack:4.9";
const S3_PORT = 4566;
const REGION = "ap-southeast-2";
const TEST_KEY = "test";

export interface LocalS3 {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop(): Promise<void>;
}

/**
 * A throwaway S3 in Docker, with the buckets made and browser uploads allowed
 * from the app's address, as the real buckets' CORS rules do.
 */
export async function startLocalS3(options: {
  buckets: readonly string[];
  allowedOrigin: string;
}): Promise<LocalS3> {
  const name = `fleetapp-e2e-s3-${randomUUID()}`;
  await run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--env",
    "SERVICES=s3",
    "--publish",
    `127.0.0.1::${S3_PORT}`,
    LOCALSTACK_IMAGE,
  ]);
  const stop = async (): Promise<void> => {
    await run("docker", ["rm", "--force", name]).catch(() => undefined);
  };
  try {
    const { stdout } = await run("docker", ["port", name, String(S3_PORT)]);
    const hostPort = stdout.trim().split(":").pop();
    const endpoint = `http://localhost:${hostPort}`;
    await waitUntilReady(`${endpoint}/_localstack/health`, "The local S3");

    const client = new S3Client({
      region: REGION,
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: TEST_KEY, secretAccessKey: TEST_KEY },
    });
    for (const bucket of options.buckets) {
      await client.send(
        new CreateBucketCommand({
          Bucket: bucket,
          CreateBucketConfiguration: { LocationConstraint: REGION },
        }),
      );
      await client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [options.allowedOrigin],
                AllowedMethods: ["GET", "POST"],
                AllowedHeaders: ["*"],
              },
            ],
          },
        }),
      );
    }
    return { endpoint, region: REGION, accessKeyId: TEST_KEY, secretAccessKey: TEST_KEY, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

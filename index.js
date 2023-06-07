'use strict';

const spawnSync = require('child_process').spawnSync;

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.commands = {
      syncToS3: {
        usage: 'Deploys the `s3LocalPath` directory to your bucket',
        lifecycleEvents: [
          'sync',
        ],
      },
      emptyBucket: {
        usage: 'Empties the deployed bucket',
        lifecycleEvents: [
          'empty',
        ],
      },
      bucketInfo: {
        usage: 'Fetches and prints out the deployed CloudFront bucket names',
        lifecycleEvents: [
          'bucketInfo',
        ],
      },
      domainInfo: {
        usage: 'Fetches and prints out the deployed CloudFront domain names',
        lifecycleEvents: [
          'domainInfo',
        ],
      },
      invalidateCloudFrontCache: {
        usage: 'Invalidates CloudFront cache',
        lifecycleEvents: [
          'invalidateCache',
        ],
      },
    };

    this.hooks = {
      'syncToS3:sync': this.syncDirectory.bind(this),
      'before:remove:remove': this.emptyBucket.bind(this),
      'emptyBucket:empty': this.emptyBucket.bind(this),
      'domainInfo:domainInfo': this.domainInfo.bind(this),
      'bucketInfo:bucketInfo': this.bucketInfo.bind(this),
      'invalidateCloudFrontCache:invalidateCache': this.invalidateCache.bind(
          this,
      ),
    };
  }

  getDescribeStacksOutput(outputKey) {
    const provider = this.serverless.getProvider('aws');
    const stackName = provider.naming.getStackName(this.options.stage);
    return provider
      .request(
        'CloudFormation',
        'describeStacks',
        { StackName: stackName },
        this.options.stage,
        this.options.region // eslint-disable-line comma-dangle
      )
      .then((result) => {
        const outputs = result.Stacks[0].Outputs;
        const output = outputs.find(entry => entry.OutputKey === outputKey);
        return output.OutputValue;
      });
  }

  // syncs the `s3LocalPath` directory to the provided bucket
  syncDirectory() {
    this.getDescribeStacksOutput('WebAppS3BucketOutput').then(s3Bucket => {
      const s3LocalPath = this.serverless.service.custom.s3LocalPath;
      const args = [
        's3',
        'sync',
        s3LocalPath,
        `s3://${s3Bucket}/`,
      ];
      this.serverless.cli.log(args);
      const { sterr } = this.runAwsCommand(args);
      if (!sterr) {
        this.serverless.cli.log('Successfully synced to the S3 bucket');
      }
    });
  }

  // Empties the deployed bucket
  emptyBucket() {
    this.getDescribeStacksOutput('WebAppS3BucketOutput').then(s3Bucket => {
      const args = [
        's3',
        'rm',
        `s3://${s3Bucket}/`,
        '--recursive'
      ];
      const { sterr } = this.runAwsCommand(args);
      if (!sterr) {
        this.serverless.cli.log('Successfully synced to the S3 bucket');
      }
    });
  }

  // fetches the bucket name from the CloudFront outputs and prints it out
  bucketInfo() {
    this.getDescribeStacksOutput('WebAppS3BucketOutput').then(outputValue =>
      this.serverless.cli.log(`Web App Bucket: ${outputValue || 'Not Found'}`)
    );
  }

  // fetches the domain name from the CloudFront outputs and prints it out
  domainInfo() {
    return this.getDescribeStacksOutput('WebAppCloudFrontDistributionOutput').then(outputValue => {
      this.serverless.cli.log(`Web App Domain: ${outputValue || 'Not Found'}`);
      return outputValue;
    });
  }

  async invalidateCache() {
    const provider = this.serverless.getProvider('aws');

    const domain = await this.domainInfo();

    const result = await provider.request(
      'CloudFront',
      'listDistributions',
      {},
      this.options.stage,
      this.options.region,
    );

    const distributions = result.DistributionList.Items;
    const distribution = distributions.find(
      entry => entry.DomainName === domain,
    );

    if (distribution) {
      this.serverless.cli.log(
        `Invalidating CloudFront distribution with id: ${distribution.Id}`,
      );
      const args = [
        'cloudfront',
        'create-invalidation',
        '--distribution-id',
        distribution.Id,
        '--paths',
        '"/*"',
      ];
      const { sterr } = this.runAwsCommand(args);
      if (!sterr) {
        this.serverless.cli.log('Successfully invalidated CloudFront cache');
      } else {
        throw new Error('Failed invalidating CloudFront cache');
      }
    } else {
      const message = `Could not find distribution with domain ${domain}`;
      const error = new Error(message);
      this.serverless.cli.log(message);
      throw error;
    }
  }

  runAwsCommand(args) {
    let command = 'aws';
    if (this.serverless.variables.service.provider.region) {
      command = `${command} --region ${this.serverless.variables.service.provider.region}`;
    }
    if (this.serverless.variables.service.provider.profile) {
      command = `${command} --profile ${this.serverless.variables.service.provider.profile}`;
    }
    const result = spawnSync(command, args, { shell: true });
    const stdout = result.stdout.toString();
    const sterr = result.stderr.toString();
    if (stdout) {
      this.serverless.cli.log(stdout);
    }
    if (sterr) {
      this.serverless.cli.log(sterr);
    }

    return { stdout, sterr };
  }
}

module.exports = ServerlessPlugin;

// tslint:disable: no-string-literal
jest.mock('fs')
jest.mock('aws-sdk')
import {Lambda} from 'aws-sdk'
import { cyan } from 'chalk'
import * as fs from 'fs'
import path from 'path'

import { ENVIRONMENT_ENV_VAR, FLUSH_TO_LOG_ENV_VAR, LAMBDA_HANDLER_ENV_VAR, LOG_LEVEL_ENV_VAR, MERGE_XRAY_TRACES_ENV_VAR, SERVICE_ENV_VAR, SITE_ENV_VAR, TRACE_ENABLED_ENV_VAR, VERSION_ENV_VAR } from '../constants'
import { UninstrumentCommand } from "../uninstrument"
import { createCommand, createMockContext, makeCli, makeMockLambda } from "./fixtures"
// tslint:disable-next-line
const {version} = require(path.join(__dirname, '../../../../package.json'))

describe('uninstrument', () => {
  describe('execute', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('prints dry run data for a valid uninstrumentation', async () => {
      ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
      ;(Lambda as any).mockImplementation(() =>
        makeMockLambda({
          'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
            Environment: {
              Variables: {
                [ENVIRONMENT_ENV_VAR]: 'staging',
                [FLUSH_TO_LOG_ENV_VAR]: 'true',
                [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
                [LOG_LEVEL_ENV_VAR]: 'debug',
                [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                [SERVICE_ENV_VAR]: 'middletier',
                [SITE_ENV_VAR]: 'datadoghq.com',
                [TRACE_ENABLED_ENV_VAR]: 'true',
                [VERSION_ENV_VAR]: '0.2',
                USER_VARIABLE: 'shouldnt be deleted by uninstrumentation',
              },
            },
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Handler: 'datadog_lambda.handler.handler',
            Layers: [
              {
                Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Extension:11',
                CodeSize: 0,
                SigningJobArn: 'some-signing-job-arn',
                SigningProfileVersionArn: 'some-signing-profile',
              },
              {
                Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Python38:49',
                CodeSize: 0,
                SigningJobArn: 'some-signing-job-arn',
                SigningProfileVersionArn: 'some-signing-profile',
              },
            ],
            Runtime: 'python3.8',
          },
        })
      )
      const cli = makeCli()
      const context = createMockContext() as any
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      process.env.DATADOG_API_KEY = '1234'
      const code = await cli.run(
        [
          'lambda',
          'uninstrument',
          '-f',
          functionARN,
          '-r',
          'us-east-1',
          '-d',
        ],
        context
      )
      const output = context.stdout.toString()
      expect(code).toBe(0)
      expect(output).toMatchInlineSnapshot(`
        "${cyan(`[Dry Run] `)}Will apply the following updates:
        UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:000000000000:function:uninstrument
        {
          \\"FunctionName\\": \\"arn:aws:lambda:us-east-1:000000000000:function:uninstrument\\",
          \\"Handler\\": \\"lambda_function.lambda_handler\\",
          \\"Environment\\": {
            \\"Variables\\": {
              \\"USER_VARIABLE\\": \\"shouldnt be deleted by uninstrumentation\\"
            }
          },
          \\"Layers\\": []
        }
        "
      `)
      
    })

    test('runs function update command for valid uninstrumentation', async () => {
      ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          Environment: {
            Variables: {
              [ENVIRONMENT_ENV_VAR]: 'staging',
              [FLUSH_TO_LOG_ENV_VAR]: 'true',
              [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
              [LOG_LEVEL_ENV_VAR]: 'debug',
              [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
              [SERVICE_ENV_VAR]: 'middletier',
              [SITE_ENV_VAR]: 'datadoghq.com',
              [TRACE_ENABLED_ENV_VAR]: 'true',
              [VERSION_ENV_VAR]: '0.2',
              USER_VARIABLE: 'shouldnt be deleted by uninstrumentation',
            },
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
          Handler: 'datadog_lambda.handler.handler',
          Layers: [
            {
              Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Extension:11',
              CodeSize: 0,
              SigningJobArn: 'some-signing-job-arn',
              SigningProfileVersionArn: 'some-signing-profile',
            },
            {
              Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Python38:49',
              CodeSize: 0,
              SigningJobArn: 'some-signing-job-arn',
              SigningProfileVersionArn: 'some-signing-profile',
            },
          ],
          Runtime: 'python3.8',
        },
      })
      ;(Lambda as any).mockImplementation(() => lambda)
      
      const cli = makeCli()
      const context = createMockContext() as any
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      process.env.DATADOG_API_KEY = '1234'
      await cli.run(
        [
          'lambda',
          'uninstrument',
          '-f',
          functionARN,
          '-r',
          'us-east-1',
        ],
        context
      )
      expect(lambda.updateFunctionConfiguration).toHaveBeenCalled()
    })
    test("aborts early when function regions can't be found", async () => {
      ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
      ;(Lambda as any).mockImplementation(() => makeMockLambda({}))

      const cli = makeCli()
      const context = createMockContext() as any
      const code = await cli.run(
        [
          'lambda',
          'uninstrument',
          '--function',
          'my-func',
        ],
        context
      )

      const output = context.stdout.toString()
      expect(code).toBe(1)
      expect(output).toMatch(
        `No default region specified for [\"my-func\"]. Use -r, --region, or use a full functionARN`
      )
    })
    test('aborts early when no functions are specified', async () => {
      ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
      ;(Lambda as any).mockImplementation(() => makeMockLambda({}))
      const cli = makeCli()
      const context = createMockContext() as any
      const code = await cli.run(
        [
          'lambda',
          'uninstrument',
        ],
        context
      )
      const output = context.stdout.toString()
      expect(code).toBe(1)
      expect(output).toMatchInlineSnapshot(`
        "No functions specified for un-instrumentation.
        "
      `)
    })
    test('aborts early when no functions are specified while using config file', async () => {
      ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({}))

      process.env = {}
      const command = createCommand(UninstrumentCommand)

      await command['execute']()
      const output = command.context.stdout.toString()
      expect(output).toMatchInlineSnapshot(`
        "No functions specified for un-instrumentation.
        "
      `)
    })
  })

  describe('printPlannedActions', () => {
    test('prints no output when list is empty', () => {
      process.env = {}
      const command = createCommand(UninstrumentCommand)

      command['printPlannedActions']([])
      const output = command.context.stdout.toString()
      expect(output).toMatchInlineSnapshot(`
       "No updates will be applied
       "
      `)
    })
  })
})

import chalk from 'chalk'
import {BaseContext} from 'clipanion'
import {Writable} from 'stream'

import {
  Assertion,
  Batch,
  ConfigOverride,
  ExecutionRule,
  MainReporter,
  Operator,
  Result,
  ServerResult,
  Step,
  Summary,
  Test,
} from '../interfaces'
import {getBatchUrl, getResultDuration, getResultOutcome, getResultUrl, ResultOutcome} from '../utils'

// Step rendering

const renderStepDuration = (duration: number) => {
  const getColor = () => {
    if (duration > 10000) {
      return chalk.bold.red
    }
    if (duration > 5000) {
      return chalk.bold.yellow
    }

    return chalk.bold
  }
  const color = getColor()

  return `${color(duration.toString())}ms`
}

const ICONS = {
  FAILED: chalk.bold.red('✖'),
  FAILED_NON_BLOCKING: chalk.bold.yellow('✖'),
  SKIPPED: chalk.bold.yellow('⇢'),
  SUCCESS: chalk.bold.green('✓'),
}

const renderStepIcon = (step: Step) => {
  if (step.error) {
    return ICONS.FAILED
  }
  if (step.skipped) {
    return ICONS.SKIPPED
  }

  return ICONS.SUCCESS
}

const renderStep = (step: Step) => {
  const duration = renderStepDuration(step.duration)
  const icon = renderStepIcon(step)

  const value = step.value ? `\n    ${chalk.dim(step.value)}` : ''
  const error = step.error ? `\n    ${chalk.red.dim(step.error)}` : ''

  return `    ${icon} | ${duration} - ${step.description}${value}${error}`
}

const renderSkippedSteps = (steps: Step[]): string | undefined => {
  if (!steps.length) {
    return
  }
  if (steps.length === 1) {
    return renderStep(steps[0])
  }

  return `    ${ICONS.SKIPPED} | ${steps.length} skipped steps`
}

const readableOperation: {[key in Operator]: string} = {
  [Operator.contains]: 'should contain',
  [Operator.doesNotContain]: 'should not contain',
  [Operator.is]: 'should be',
  [Operator.isNot]: 'should not be',
  [Operator.lessThan]: 'should be less than',
  [Operator.matches]: 'should match',
  [Operator.doesNotMatch]: 'should not match',
  [Operator.isInLessThan]: 'will expire in less than',
  [Operator.isInMoreThan]: 'will expire in more than',
  [Operator.lessThanOrEqual]: 'should be less than or equal to',
  [Operator.moreThan]: 'should be more than',
  [Operator.moreThanOrEqual]: 'should be less than or equal to',
  [Operator.validatesJSONPath]: 'assert on JSONPath extracted value',
  [Operator.validatesXPath]: 'assert on XPath extracted value',
}

const renderApiError = (errorCode: string, errorMessage: string, color: chalk.Chalk) => {
  if (errorCode === 'INCORRECT_ASSERTION') {
    try {
      const assertionsErrors: Assertion[] = JSON.parse(errorMessage)
      const output = ['  - Assertion(s) failed:']
      output.push(
        ...assertionsErrors.map((error) => {
          const expected = chalk.underline(`${error.target}`)
          const actual = chalk.underline(`${error.actual}`)

          return `▶ ${error.type} ${readableOperation[error.operator]} ${expected}. Actual: ${actual}`
        })
      )

      return color(output.join('\n    '))
    } catch (e) {
      // JSON parsing failed, do nothing to return the raw error
    }
  }

  return chalk.red(`    [${chalk.bold(errorCode)}] - ${chalk.dim(errorMessage)}`)
}

// Test execution rendering
const renderResultOutcome = (
  result: ServerResult,
  test: Test,
  icon: string,
  color: chalk.Chalk
): string | undefined => {
  if (result.unhealthy) {
    const error =
      result.failure && result.failure.message !== 'Unknown error' ? result.failure.message : 'General Error'

    return [
      `  ${chalk.yellow(`${ICONS.SKIPPED} | ${error}`)}`,
      `  ${chalk.yellow('We had an error during the execution of this test. The result will be ignored')}`,
    ].join('\n')
  }

  if (test.type === 'api') {
    const requestDescription = renderApiRequestDescription(test.subtype, test.config)

    if (result.failure) {
      return [
        `  ${icon} ${color(requestDescription)}`,
        renderApiError(result.failure.code, result.failure.message, color),
      ].join('\n')
    }

    return `  ${icon} ${color(requestDescription)}`
  }

  if (test.type === 'browser') {
    // We render the step only if the test hasn't passed to avoid cluttering the output.
    if (!result.passed && 'stepDetails' in result) {
      const criticalFailedStepIndex = result.stepDetails.findIndex((s) => s.error && !s.allowFailure) + 1
      const stepsDisplay = result.stepDetails.slice(0, criticalFailedStepIndex).map(renderStep)

      const skippedStepDisplay = renderSkippedSteps(result.stepDetails.slice(criticalFailedStepIndex))
      if (skippedStepDisplay) {
        stepsDisplay.push(skippedStepDisplay)
      }

      return stepsDisplay.join('\n')
    }

    if (result.failure) {
      return chalk.red(`    [${chalk.bold(result.failure.code)}] - ${chalk.dim(result.failure.message)}`)
    }

    return ''
  }
}

const renderApiRequestDescription = (subType: string, config: Test['config']): string => {
  const {request, steps} = config
  if (subType === 'dns') {
    const text = `Query for ${request.host}`
    if (request.dnsServer) {
      return `${text} on server ${request.dnsServer}`
    }

    return text
  }

  if (subType === 'ssl' || subType === 'tcp') {
    return `Host: ${request.host}:${request.port}`
  }

  if (subType === 'multi' && steps) {
    const stepsDescription = Object.entries(
      steps
        .map((step) => step.subtype)
        .reduce((counts, type) => {
          counts[type] = (counts[type] || 0) + 1

          return counts
        }, {} as {[key: string]: number})
    )
      .map(([type, count]) => `${count} ${type.toUpperCase()} test`)
      .join(', ')

    return `Multistep test containing ${stepsDescription}`
  }

  if (subType === 'http') {
    return `${chalk.bold(request.method)} - ${request.url}`
  }

  return `${chalk.bold(subType)} test`
}

const renderExecutionResult = (test: Test, execution: Result, baseUrl: string) => {
  const {executionRule, test: overriddenTest, resultId, result, timedOut} = execution
  const resultOutcome = getResultOutcome(execution)
  const [icon, setColor] = getResultIconAndColor(resultOutcome)

  const executionRuleText = [ResultOutcome.Passed, ResultOutcome.PassedNonBlocking].includes(resultOutcome)
    ? ''
    : `[${setColor(executionRule === ExecutionRule.BLOCKING ? 'blocking' : 'non-blocking')}] `

  const testLabel = `${executionRuleText}[${chalk.bold.dim(test.public_id)}] ${chalk.bold(test.name)}`

  const location = setColor(`location: ${chalk.bold(execution.location)}`)
  const device =
    test.type === 'browser' && 'device' in result ? ` - ${setColor(`device: ${chalk.bold(result.device.id)}`)}` : ''
  const resultIdentification = `${icon} ${testLabel} - ${location}${device}`

  const outputLines = [resultIdentification]

  // Unhealthy test results don't have a duration or result URL
  if (!result.unhealthy) {
    const duration = getResultDuration(result)
    const durationText = duration ? ` Total duration: ${duration} ms -` : ''

    const resultUrl = getResultUrl(baseUrl, test, resultId)
    const resultUrlStatus = timedOut ? '(not yet received)' : ''

    const resultInfo = `  ⎋${durationText} Result URL: ${chalk.dim.cyan(resultUrl)} ${resultUrlStatus}`
    outputLines.push(resultInfo)
  }

  const resultOutcomeText = renderResultOutcome(result, overriddenTest || test, icon, setColor)
  if (resultOutcomeText) {
    outputLines.push(resultOutcomeText)
  }

  return outputLines.join('\n')
}

const getResultIconAndColor = (resultOutcome: ResultOutcome): [string, chalk.Chalk] => {
  if (resultOutcome === ResultOutcome.Passed || resultOutcome === ResultOutcome.PassedNonBlocking) {
    return [ICONS.SUCCESS, chalk.bold.green]
  }

  if (resultOutcome === ResultOutcome.FailedNonBlocking) {
    return [ICONS.FAILED_NON_BLOCKING, chalk.bold.yellow]
  }

  return [ICONS.FAILED, chalk.bold.red]
}

export class DefaultReporter implements MainReporter {
  private write: Writable['write']

  constructor({context}: {context: BaseContext}) {
    this.write = context.stdout.write.bind(context.stdout)
  }

  public error(error: string) {
    this.write(error)
  }

  public initErrors(errors: string[]) {
    this.write(errors.join('\n') + '\n\n')
  }

  public log(log: string) {
    this.write(log)
  }

  public reportStart(timings: {startTime: number}) {
    const delay = (Date.now() - timings.startTime).toString()

    this.write(['', chalk.bold.cyan('=== REPORT ==='), `Took ${chalk.bold(delay)}ms`, '\n'].join('\n'))
  }

  public resultEnd(result: Result, baseUrl: string) {
    this.write(renderExecutionResult(result.test, result, baseUrl) + '\n\n')
  }

  public resultReceived(result: Batch['results'][0]): void {
    return
  }

  public runEnd(summary: Summary, baseUrl: string) {
    const {bold: b, gray, green, red, yellow} = chalk

    const lines: string[] = []

    const runSummary = [green(`${b(summary.passed)} passed`), red(`${b(summary.failed)} failed`)]

    if (summary.failedNonBlocking) {
      runSummary.push(yellow(`${b(summary.failedNonBlocking)} failed (non-blocking)`))
    }

    if (summary.skipped) {
      runSummary.push(`${b(summary.skipped)} skipped`)
    }

    if (summary.testsNotFound.size > 0) {
      const testsNotFoundListStr = gray(`(${[...summary.testsNotFound].join(', ')})`)
      lines.push(
        `${yellow(
          `${b(summary.testsNotFound.size)} ${pluralize('test', summary.testsNotFound.size)} not found`
        )} ${testsNotFoundListStr}`
      )
    }

    const extraInfo = []
    if (summary.timedOut) {
      extraInfo.push(yellow(`${b(summary.timedOut)} timed out`))
    }
    if (summary.criticalErrors) {
      extraInfo.push(red(`${b(summary.criticalErrors)} critical errors`))
    }
    const extraInfoStr = extraInfo.length ? ' (' + extraInfo.join(', ') + ')' : ''

    if (summary.batchId) {
      const batchUrl = getBatchUrl(baseUrl, summary.batchId)
      lines.push('Results URL: ' + chalk.dim.cyan(batchUrl))
    }
    lines.push(`${b('Run summary:')} ${runSummary.join(', ')}${extraInfoStr}\n\n`)

    this.write(lines.join('\n'))
  }

  public testsWait(tests: Test[]) {
    const testsList = tests.map((t) => t.public_id)
    if (testsList.length > 10) {
      testsList.splice(10)
      testsList.push('…')
    }
    const testsDisplay = chalk.gray(`(${testsList.join(', ')})`)

    this.write(
      `Waiting for ${chalk.bold.cyan(tests.length)} test ${pluralize('result', tests.length)} ${testsDisplay}…\n`
    )
  }

  public testTrigger(test: Pick<Test, 'name'>, testId: string, executionRule: ExecutionRule, config: ConfigOverride) {
    const idDisplay = `[${chalk.bold.dim(testId)}]`

    const getMessage = () => {
      if (executionRule === ExecutionRule.SKIPPED) {
        // Test is either skipped from datadog-ci config or from test config
        const isSkippedByCIConfig = config.executionRule === ExecutionRule.SKIPPED
        if (isSkippedByCIConfig) {
          return `Skipped test "${chalk.yellow.dim(test.name)}"`
        } else {
          return `Skipped test "${chalk.yellow.dim(test.name)}" because of execution rule configuration in Datadog`
        }
      }

      if (executionRule === ExecutionRule.NON_BLOCKING) {
        return `Found test "${chalk.green.bold(test.name)}" (non-blocking)`
      }

      return `Found test "${chalk.green.bold(test.name)}"`
    }

    const getConfigOverridesPart = () => {
      const nbConfigsOverridden = Object.keys(config).length
      if (nbConfigsOverridden === 0 || executionRule === ExecutionRule.SKIPPED) {
        return ''
      }

      return ' ' + chalk.gray(`(${nbConfigsOverridden} config ${pluralize('override', nbConfigsOverridden)})`)
    }

    this.write(`${idDisplay} ${getMessage()}${getConfigOverridesPart()}\n`)
  }

  public testWait(test: Test) {
    return
  }
}

const pluralize = (word: string, count: number): string => (count === 1 ? word : `${word}s`)

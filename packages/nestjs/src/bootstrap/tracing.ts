import * as CallbackManagerModule from "@langchain/core/callbacks/manager";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { LangChainInstrumentation } from "@traceloop/instrumentation-langchain";
import { OpenAIInstrumentation } from "@traceloop/instrumentation-openai";
import { OpenAI } from "openai";

const metricExporter = new OTLPMetricExporter();
const traceExporter = new OTLPTraceExporter();

// constructed instrumentations
const openAIInstrumentation = new OpenAIInstrumentation({});
openAIInstrumentation.manuallyInstrument(OpenAI);

const langchainInstrumentation = new LangChainInstrumentation({});
langchainInstrumentation.manuallyInstrument({
  callbackManagerModule: CallbackManagerModule,
});

const otelSDK = new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 1000,
  }),
  spanProcessors: [new BatchSpanProcessor(traceExporter)],
  contextManager: new AsyncLocalStorageContextManager(),
  // textMapPropagator: new CompositePropagator({
  //   propagators: [
  //     new JaegerPropagator(),
  //     new W3CTraceContextPropagator(),
  //     new W3CBaggagePropagator(),
  //     new B3Propagator(),
  //   ],
  // }),
  instrumentations: [
    getNodeAutoInstrumentations(),
    openAIInstrumentation,
    langchainInstrumentation,
  ],
});

export default otelSDK;

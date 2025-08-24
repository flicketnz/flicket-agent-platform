import { HttpService } from "@nestjs/axios";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { isAxiosError } from "@nestjs/terminus/dist/utils";
import { firstValueFrom, timeout } from "rxjs";
import agentSnowflakeCortexConfig from "src/modules/config-management/configs/agent-snowflake-cortex.config";

import { SnowflakeJwtService } from "./snowflake-jwt.service";

/**
 * Interface for Snowflake SQL REST API v2 request
 */
export interface SnowflakeSQLRequest {
  statement: string;
  timeout?: number;
  database?: string;
  schema?: string;
  warehouse?: string;
  role?: string;
  bindings?: Record<string, any>;
  parameters?: {
    QUERY_TAG?: string;
    BINARY_OUTPUT_FORMAT?: string;
  };
}

/**
 * Interface for Snowflake SQL REST API v2 response
 */
export interface SnowflakeSQLResponse {
  resultSetMetaData: {
    numRows: number;
    format: string;
    partitionInfo?: any[];
    rowType: Array<{
      name: string;
      type: string;
      length?: number;
      precision?: number;
      scale?: number;
      nullable: boolean;
    }>;
  };
  data: any[][];
  code: string;
  message: string;
  success: boolean;
  statementHandle?: string;
  createdOn: number;
  statementStatusUrl?: string;
}

/**
 * Interface for SQL execution options
 */
export interface SQLExecutionOptions {
  timeout?: number;
  database?: string;
  schema?: string;
  warehouse?: string;
}

/**
 * Interface for tenant context
 */
export interface TenantContext {
  /**
   * Tenants are 'organizations' in the flicket context
   */
  tenantId: string;
}

/**
 * Interface for formatted SQL results
 */
export interface FormattedSQLResults {
  tableFormat: string;
  summaryText: string;
  chartData?: any;
  insights?: string[];
}

/**
 * Interface for SQL execution result
 */
export interface SQLExecutionResult {
  data: any[][];
  metadata: SnowflakeSQLResponse["resultSetMetaData"];
  executionTime: number;
  rowCount: number;
  formattedResults?: FormattedSQLResults;
  success: boolean;
  error?: string;
}

@Injectable()
export class SnowflakeSQLService {
  private readonly logger = new Logger(SnowflakeSQLService.name);

  constructor(
    private readonly httpService: HttpService,
    private jwtService: SnowflakeJwtService,
    @Inject(agentSnowflakeCortexConfig.KEY)
    private readonly config: ConfigType<typeof agentSnowflakeCortexConfig>,
  ) {
    // Set auth via an interceptor so the token is updated on every call (if required)
    httpService.axiosRef.interceptors.request.use(
      (config) => {
        const token = this.jwtService.getJwt();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
          config.headers["X-Snowflake-Authorization-Token-Type"] =
            "KEYPAIR_JWT";
        }
        return config;
      },
      (error) => {
        if (error instanceof Error) {
          return Promise.reject(error);
        } else {
          return Promise.reject(new Error(error));
        }
      },
    );
  }

  /**
   * Execute SQL statement with optional tenant isolation
   */
  async executeSQL(
    statement: string,
    options: SQLExecutionOptions = {},
  ): Promise<SQLExecutionResult> {
    const startTime = Date.now();

    try {
      // Apply tenant segmentation if context provided
      const finalStatement = statement;

      // Build request payload with config defaults
      const requestPayload: SnowflakeSQLRequest = {
        statement: finalStatement,
        timeout: options.timeout || this.config.maxSqlExecutionTimeSeconds,
        database: options.database || this.config.defaultDatabase,
        schema: options.schema || this.config.defaultSchema,
        warehouse: options.warehouse || this.config.defaultWarehouse,

        // parameters: {
        //   QUERY_TAG: "flicket-agent-platform",
        // },
      };

      this.logger.debug("Executing SQL via Snowflake API v2", {
        requestPayload,
      });

      // Execute SQL via Snowflake SQL REST API v2
      const response = await firstValueFrom(
        this.httpService
          .post<SnowflakeSQLResponse>("/api/v2/statements", requestPayload)
          .pipe(
            timeout(
              // add 2 seconds so that the rest api which also carries the timeout may potentially gracefully exit first
              ((options.timeout || this.config.maxSqlExecutionTimeSeconds) +
                2) *
                1000,
            ),
          ),
      );

      const executionTime = Date.now() - startTime;

      if (response.status !== 200) {
        throw new Error(`SQL execution failed: ${response.data.message}`);
      }

      // Format results
      const formattedResults = this.formatResults(response.data);

      // Apply row limit from config or options
      const resultData = response.data.data;

      this.logger.log(
        `SQL execution completed successfully in ${executionTime}ms`,
        {
          rowCount: response.data.resultSetMetaData.numRows,
          executionTime,
        },
      );

      return {
        data: resultData,
        metadata: response.data.resultSetMetaData,
        executionTime,
        rowCount: response.data.resultSetMetaData.numRows,
        formattedResults,
        success: true,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      this.logger.error("SQL execution failed", {
        error: errorMessage,
        executionTime,
        sqlHash: statement,
      });

      if (error instanceof Error) {
        if (isAxiosError(error)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          this.logger.error("Axios Response", error.response.data);
        }
        if (
          "response" in error &&
          error.response &&
          error.response !== undefined &&
          typeof error.response == "object" &&
          "data" in error.response
        ) {
          const axiosError = error.response.data as
            | { message?: string; code?: string }
            | undefined;
          const snowflakeError =
            axiosError?.message || axiosError?.code || errorMessage;

          return {
            data: [],
            metadata: { numRows: 0, format: "json", rowType: [] },
            executionTime,
            rowCount: 0,
            success: false,
            error: `SQL execution failed: ${snowflakeError}`,
          };
        }
      }

      return {
        data: [],
        metadata: { numRows: 0, format: "json", rowType: [] },
        executionTime,
        rowCount: 0,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Add tenant segmentation to SQL statement
   */
  public applySegmentationToStatement(
    statement: string,
    tenantContext: TenantContext,
  ): string {
    // TODO: apply the segmentation properly
    this.logger.warn(
      "THE TENNANT SEGMENTATION IS NOT IMPLEMENTED CORRECTLY AND NEEDS ATTENTION. Remove this warning when you have done this",
    );
    // This is a no-op. In production, you'd want to use a proper SQL parser
    // like node-sql-parser or similar to safely modify the AST

    return statement;
  }

  /**
   * Format SQL results for presentation
   */
  private formatResults(response: SnowflakeSQLResponse): FormattedSQLResults {
    const { data, resultSetMetaData } = response;

    if (!data || data.length === 0) {
      return {
        tableFormat: "No results found.",
        summaryText: "The query returned no results.",
        insights: ["No data to analyze"],
      };
    }

    // Create ASCII table format
    const headers = resultSetMetaData.rowType.map((col) => col.name);
    const tableFormat = this.createAsciiTable(headers, data);

    // Generate summary
    const rowCount = data.length;
    const columnCount = headers.length;
    const summaryText = `Query returned ${rowCount} row${rowCount === 1 ? "" : "s"} with ${columnCount} column${columnCount === 1 ? "" : "s"}.`;

    // Generate basic insights
    const insights = this.generateInsights(headers, data);

    return {
      tableFormat,
      summaryText,
      insights,
    };
  }

  /**
   * Create ASCII table from data
   */
  private createAsciiTable(headers: string[], data: any[][]): string {
    if (data.length === 0) return "No data";

    // Determine column widths
    const columnWidths = headers.map((header, i) => {
      const dataWidth = Math.max(
        ...data.map((row) => String(row[i] || "").length),
      );
      return Math.max(header.length, dataWidth, 3);
    });

    // Create header row
    const headerRow =
      "| " +
      headers.map((header, i) => header.padEnd(columnWidths[i])).join(" | ") +
      " |";

    // Create separator row
    const separatorRow =
      "|" + columnWidths.map((width) => "-".repeat(width + 2)).join("|") + "|";

    // Create data rows (limit to first 10 rows for display)
    const displayData = data.slice(0, 10);
    const dataRows = displayData.map(
      (row) =>
        "| " +
        row
          .map((cell, i) => String(cell || "").padEnd(columnWidths[i]))
          .join(" | ") +
        " |",
    );

    const result = [headerRow, separatorRow, ...dataRows];

    // Add truncation notice if needed
    if (data.length > 10) {
      result.push(`... (showing 10 of ${data.length} rows)`);
    }

    return result.join("\n");
  }

  /**
   * Generate basic insights from data
   */
  private generateInsights(headers: string[], data: any[][]): string[] {
    const insights: string[] = [];

    if (data.length === 0) {
      insights.push("No data to analyze");
      return insights;
    }

    // Basic insights
    insights.push(
      `Dataset contains ${data.length} records across ${headers.length} fields`,
    );

    // Analyze numeric columns
    headers.forEach((header, colIndex) => {
      const values = data
        .map((row) => row[colIndex] as unknown)
        .filter((val) => val !== null && val !== undefined);

      if (values.length === 0) return;

      // Check if column contains numbers
      const numericValues = values
        .filter((val) => !isNaN(Number(val)))
        .map((val) => Number(val));

      if (
        numericValues.length > values.length * 0.8 &&
        numericValues.length > 0
      ) {
        const avg =
          numericValues.reduce((sum, val) => sum + val, 0) /
          numericValues.length;
        const max = Math.max(...numericValues);
        const min = Math.min(...numericValues);

        insights.push(
          `${header}: avg=${avg.toFixed(2)}, min=${min}, max=${max}`,
        );
      }
    });

    return insights;
  }
}

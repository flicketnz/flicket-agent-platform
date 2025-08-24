import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";

import type { SnowflakeJwtService } from "../snowflake-jwt.service";
import {
  SnowflakeSQLResponse,
  SnowflakeSQLService,
} from "../snowflake-sql.service";

describe("SnowflakeSQLService", () => {
  let service: SnowflakeSQLService;
  let mockHttpService: HttpService;
  let mockJwtService: SnowflakeJwtService;
  let mockPost: MockedFunction<any>;

  const mockConfig = {
    enabled: true,
    maxSqlExecutionTimeSeconds: 30,
    defaultDatabase: "TEST_DB",
    defaultSchema: "PUBLIC",
    defaultWarehouse: "COMPUTE_WH",
    endpoint: "https://test.snowflakecomputing.com",
    privateKey: "test-key",
    publicKeyFingerprint: "test-fingerprint",
    user: "test-user",
    accountIdentifier: "test-account",
  };

  beforeEach(() => {
    mockPost = vi.fn();

    mockHttpService = {
      post: mockPost,
      axiosRef: {
        interceptors: {
          request: {
            use: vi.fn(),
          },
        },
      },
    } as unknown as HttpService;

    mockJwtService = {
      getJwt: vi.fn().mockReturnValue("mock-jwt-token"),
    } as unknown as SnowflakeJwtService;

    service = new SnowflakeSQLService(
      mockHttpService,
      mockJwtService,
      mockConfig,
    );
  });

  describe("executeSQL", () => {
    it("should execute SQL successfully and return formatted results", async () => {
      const mockResponse: SnowflakeSQLResponse = {
        resultSetMetaData: {
          numRows: 2,
          format: "json",
          rowType: [
            { name: "id", type: "NUMBER", nullable: false },
            { name: "name", type: "TEXT", nullable: true },
          ],
        },
        data: [
          [1, "Event 1"],
          [2, "Event 2"],
        ],
        code: "090001",
        message: "Statement executed successfully.",
        success: true,
        createdOn: Date.now(),
      };

      mockPost.mockReturnValue(of({ status: 200, data: mockResponse }));

      const result = await service.executeSQL(
        "SELECT id, name FROM events LIMIT 2",
      );

      expect(result.success).toBe(true);
      expect(result.rowCount).toBe(2);
      expect(result.data).toEqual([
        [1, "Event 1"],
        [2, "Event 2"],
      ]);
      expect(result.formattedResults).toBeDefined();
      expect(result.formattedResults?.tableFormat).toContain("id");
      expect(result.formattedResults?.tableFormat).toContain("name");
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it("should use default configuration values when options not provided", async () => {
      const mockResponse: SnowflakeSQLResponse = {
        resultSetMetaData: {
          numRows: 1,
          format: "json",
          rowType: [{ name: "id", type: "NUMBER", nullable: false }],
        },
        data: [[1]],
        code: "090001",
        message: "Statement executed successfully.",
        success: true,
        createdOn: Date.now(),
      };

      mockPost.mockReturnValue(of({ status: 200, data: mockResponse }));

      await service.executeSQL("SELECT id FROM events");

      expect(mockPost).toHaveBeenCalledWith("/api/v2/statements", {
        statement: "SELECT id FROM events",
        timeout: 30,
        database: "TEST_DB",
        schema: "PUBLIC",
        warehouse: "COMPUTE_WH",
      });
    });

    it("should use provided options to override defaults", async () => {
      const mockResponse: SnowflakeSQLResponse = {
        resultSetMetaData: {
          numRows: 1,
          format: "json",
          rowType: [{ name: "id", type: "NUMBER", nullable: false }],
        },
        data: [[1]],
        code: "090001",
        message: "Statement executed successfully.",
        success: true,
        createdOn: Date.now(),
      };

      mockPost.mockReturnValue(of({ status: 200, data: mockResponse }));

      const options = {
        timeout: 60,
        database: "OVERRIDE_DB",
        schema: "OVERRIDE_SCHEMA",
        warehouse: "OVERRIDE_WH",
      };

      await service.executeSQL("SELECT id FROM events", options);

      expect(mockPost).toHaveBeenCalledWith("/api/v2/statements", {
        statement: "SELECT id FROM events",
        timeout: 60,
        database: "OVERRIDE_DB",
        schema: "OVERRIDE_SCHEMA",
        warehouse: "OVERRIDE_WH",
      });
    });

    it("should handle HTTP errors gracefully", async () => {
      const errorResponse = new Error("Request failed");
      // Add response property with proper typing
      Object.assign(errorResponse, {
        response: {
          data: {
            code: "000904",
            message: "SQL compilation error",
            success: false,
          },
        },
      });

      mockPost.mockReturnValue(throwError(() => errorResponse));

      const result = await service.executeSQL(
        "SELECT * FROM nonexistent_table",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("SQL compilation error");
      expect(result.data).toEqual([]);
      expect(result.rowCount).toBe(0);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it("should handle non-200 HTTP status codes", async () => {
      const mockResponse: SnowflakeSQLResponse = {
        resultSetMetaData: {
          numRows: 0,
          format: "json",
          rowType: [],
        },
        data: [],
        code: "400001",
        message: "Bad request",
        success: false,
        createdOn: Date.now(),
      };

      mockPost.mockReturnValue(of({ status: 400, data: mockResponse }));

      const result = await service.executeSQL("INVALID SQL");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Bad request");
    });

    it("should handle generic errors without response data", async () => {
      const genericError = new Error("Network timeout");
      mockPost.mockReturnValue(throwError(() => genericError));

      const result = await service.executeSQL("SELECT * FROM events");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network timeout");
      expect(result.data).toEqual([]);
      expect(result.rowCount).toBe(0);
    });
  });

  describe("result formatting", () => {
    it("should generate insights for numeric data", async () => {
      const mockResponse: SnowflakeSQLResponse = {
        resultSetMetaData: {
          numRows: 3,
          format: "json",
          rowType: [
            { name: "id", type: "NUMBER", nullable: false },
            { name: "price", type: "NUMBER", nullable: false },
          ],
        },
        data: [
          [1, 10.5],
          [2, 15.75],
          [3, 8.25],
        ],
        code: "090001",
        message: "Statement executed successfully.",
        success: true,
        createdOn: Date.now(),
      };

      mockPost.mockReturnValue(of({ status: 200, data: mockResponse }));

      const result = await service.executeSQL("SELECT id, price FROM tickets");

      expect(result.success).toBe(true);
      expect(result.formattedResults?.insights).toBeDefined();
      expect(result.formattedResults?.insights?.length).toBeGreaterThan(0);
      // Look for the price insight
      const priceInsight = result.formattedResults?.insights?.find(
        (insight) =>
          insight.includes("price:") &&
          insight.includes("avg=") &&
          insight.includes("min=") &&
          insight.includes("max="),
      );
      expect(priceInsight).toBeDefined();
      expect(priceInsight).toBe("price: avg=11.50, min=8.25, max=15.75");
    });

    it("should handle empty results gracefully", async () => {
      const mockResponse: SnowflakeSQLResponse = {
        resultSetMetaData: {
          numRows: 0,
          format: "json",
          rowType: [{ name: "id", type: "NUMBER", nullable: false }],
        },
        data: [],
        code: "090001",
        message: "Statement executed successfully.",
        success: true,
        createdOn: Date.now(),
      };

      mockPost.mockReturnValue(of({ status: 200, data: mockResponse }));

      const result = await service.executeSQL(
        "SELECT id FROM events WHERE 1=0",
      );

      expect(result.success).toBe(true);
      expect(result.rowCount).toBe(0);
      expect(result.formattedResults?.tableFormat).toBe("No results found.");
      expect(result.formattedResults?.insights).toContain("No data to analyze");
    });

    it("should create ASCII table format for results", async () => {
      const mockResponse: SnowflakeSQLResponse = {
        resultSetMetaData: {
          numRows: 2,
          format: "json",
          rowType: [
            { name: "id", type: "NUMBER", nullable: false },
            { name: "name", type: "TEXT", nullable: true },
          ],
        },
        data: [
          [1, "Test Event"],
          [2, "Another Event"],
        ],
        code: "090001",
        message: "Statement executed successfully.",
        success: true,
        createdOn: Date.now(),
      };

      mockPost.mockReturnValue(of({ status: 200, data: mockResponse }));

      const result = await service.executeSQL("SELECT id, name FROM events");

      expect(result.formattedResults?.tableFormat).toContain("| id");
      expect(result.formattedResults?.tableFormat).toContain("| name");
      expect(result.formattedResults?.tableFormat).toContain("Test Event");
      expect(result.formattedResults?.tableFormat).toContain("Another Event");
    });

    it("should truncate display to 10 rows with notice", async () => {
      const mockData = Array.from({ length: 15 }, (_, i) => [
        i + 1,
        `Item ${i + 1}`,
      ]);

      const mockResponse: SnowflakeSQLResponse = {
        resultSetMetaData: {
          numRows: 15,
          format: "json",
          rowType: [
            { name: "id", type: "NUMBER", nullable: false },
            { name: "name", type: "TEXT", nullable: true },
          ],
        },
        data: mockData,
        code: "090001",
        message: "Statement executed successfully.",
        success: true,
        createdOn: Date.now(),
      };

      mockPost.mockReturnValue(of({ status: 200, data: mockResponse }));

      const result = await service.executeSQL("SELECT id, name FROM events");

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(15); // All data preserved
      expect(result.rowCount).toBe(15);
      expect(result.formattedResults?.tableFormat).toContain(
        "showing 10 of 15 rows",
      );
    });
  });

  describe("applySegmentationToStatement", () => {
    it("should return statement unchanged (current no-op implementation)", () => {
      const statement = "SELECT * FROM events";
      const tenantContext = { tenantId: "tenant-123" };

      const result = service.applySegmentationToStatement(
        statement,
        tenantContext,
      );

      expect(result).toBe(statement);
    });
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResourceAllocationDashboard from "./ResourceAllocationDashboard";
import { api } from "./api";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: () => null,
  Popup: () => null,
  Polyline: () => null,
  GeoJSON: () => null,
  Pane: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useMap: () => ({
    fitBounds: () => undefined,
    invalidateSize: () => undefined,
    getSize: () => ({ x: 800, y: 600 }),
    getContainer: () => document.createElement("div"),
  }),
}));

vi.mock("./api", () => ({
  api: {
    inventory: vi.fn().mockResolvedValue({ region: "east", location: "Bago East", classes: [], movements: [] }),
    census: vi.fn().mockResolvedValue({ districts: [] }),
    allocationPlan: vi.fn().mockResolvedValue({
      plan_id: "p1",
      planning_date: "2026-10-20",
      warehouse: { id: "depot-bago", name: "Bago depot (east)", region: "east", latitude: 17.335, longitude: 96.481 },
      warehouses: [],
      totals: { affected_population: 0, available_stock_units: 0, resources_needed_units: 0 },
      rows: [],
      shortages: [],
      routes: [],
      model_version: "test",
      disclaimer: "Test",
    }),
    predictionMapScores: vi.fn().mockResolvedValue({ date: "2026-10-20", model_version: "test", cached: false, scores: [] }),
    helpSummary: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
});

describe("ResourceAllocationDashboard", () => {
  it("shows read-only high/severe scope and sends min_priority high", async () => {
    render(
      <ResourceAllocationDashboard startDate="2026-10-20" onStartDate={() => undefined} focus={null} />,
    );

    expect(screen.getByText("High and severe only")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create plan & dispatch" }));

    await waitFor(() => expect(api.allocationPlan).toHaveBeenCalled());
    expect(api.allocationPlan).toHaveBeenCalledWith(
      expect.objectContaining({ min_priority: "high", include_all_high_severe: true }),
    );
  });

  it("shows focus risk when opened from flood prediction", async () => {
    render(
      <ResourceAllocationDashboard
        startDate="2026-10-20"
        onStartDate={() => undefined}
        focus={{
          townshipId: "MMR007001701",
          townshipName: "Bago",
          date: "2026-10-20",
          riskLevel: "high",
          latitude: 17.33,
          longitude: 96.48,
        }}
      />,
    );

    expect(screen.getByText("High risk")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create plan & dispatch" }));
    await waitFor(() => expect(api.allocationPlan).toHaveBeenCalled());
    expect(api.allocationPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        min_priority: "high",
        include_all_high_severe: false,
        township_ids: ["MMR007001701"],
      }),
    );
  });
});

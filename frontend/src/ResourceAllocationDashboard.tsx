import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import RouteMap, { type MapRoutePath, type MapStop } from "./components/RouteMap";
import type { AllocationFocus } from "./lib/allocationFocus";
import { errorText } from "./lib/formatError";
import { demoAffectedPeople } from "./lib/demoAffected";
import { depotRegionForCoordinates, type DepotRegion } from "./lib/depotRegion";
import { splitAffectedBySex } from "./lib/populationSplit";
import { riskLabel } from "./components/prediction/mapUtils";
import type {
  AllocationPlanResponse,
  AssistancePriority,
  AllocationTownshipRow,
  CensusResponse,
  HelpDay,
  InventorySnapshot,
  LoadState,
  PredictionMapScoresResponse,
  TownshipCensus,
} from "./types";

interface ResourceAllocationDashboardProps {
  startDate: string;
  onStartDate: (value: string) => void;
  focus?: AllocationFocus | null;
  onClearFocus?: () => void;
  onOpenInventory?: () => void;
}

interface Resource<T> {
  state: LoadState;
  data?: T;
  error?: string;
}

const loading = <T,>(): Resource<T> => ({ state: "loading" });

function findTownshipCensus(census: CensusResponse | undefined, nameEn: string): TownshipCensus | undefined {
  if (!census) return undefined;
  for (const district of census.districts) {
    const match = district.townships.find((township) => township.name_en === nameEn);
    if (match) return match;
  }
  return undefined;
}

/** Plans include high and severe townships only (backend min_priority threshold). */
const ALLOCATION_MIN_PRIORITY: AssistancePriority = "high";

function isHighOrSeverePriority(priority: AssistancePriority): boolean {
  return priority === "high" || priority === "severe";
}

type RegionCode = DepotRegion;

const DEFAULT_DEPOTS: MapStop[] = [
  {
    id: "depot-bago",
    name: "Bago depot (east)",
    latitude: 17.335,
    longitude: 96.481,
    kind: "depot-east",
  },
  {
    id: "depot-pyay",
    name: "Pyay depot (west)",
    latitude: 18.817,
    longitude: 95.217,
    kind: "depot-west",
  },
];

function depotLabel(region: RegionCode): string {
  return region === "east" ? "Bago (east)" : "Pyay (west)";
}

function planRequestBody(startDate: string, focus: AllocationFocus | null | undefined) {
  return {
    date: startDate,
    warehouse_region: "auto" as const,
    min_priority: ALLOCATION_MIN_PRIORITY,
    // Focused view: one date + one township. Region view: all high/severe townships that day.
    include_all_high_severe: !focus,
    township_ids: focus ? [focus.townshipId] : undefined,
    commit_inventory: true,
    vehicle_profile: "truck" as const,
  };
}

export default function ResourceAllocationDashboard({
  startDate,
  focus,
  onClearFocus,
  onOpenInventory,
}: ResourceAllocationDashboardProps) {
  const [inventoryEast, setInventoryEast] = useState<Resource<InventorySnapshot>>(loading);
  const [inventoryWest, setInventoryWest] = useState<Resource<InventorySnapshot>>(loading);
  const [plan, setPlan] = useState<Resource<AllocationPlanResponse>>({ state: "empty" });
  const [census, setCensus] = useState<Resource<CensusResponse>>({ state: "empty" });
  const [helpOutlook, setHelpOutlook] = useState<Resource<HelpDay>>({ state: "empty" });
  const [mapScores, setMapScores] = useState<Resource<PredictionMapScoresResponse>>(loading);

  const refreshInventory = async () => {
    setInventoryEast(loading);
    setInventoryWest(loading);
    try {
      const [east, west] = await Promise.all([api.inventory("east"), api.inventory("west")]);
      setInventoryEast({ state: "ready", data: east });
      setInventoryWest({ state: "ready", data: west });
    } catch (reason) {
      const message = errorText(reason);
      setInventoryEast({ state: "error", error: message });
      setInventoryWest({ state: "error", error: message });
    }
  };

  useEffect(() => {
    void refreshInventory();
  }, []);

  useEffect(() => {
    let active = true;
    const loadContext = async () => {
      setCensus(loading);
      try {
        const payload = await api.census();
        if (active) setCensus({ state: "ready", data: payload });
      } catch (reason) {
        if (active) setCensus({ state: "error", error: errorText(reason) });
      }
    };
    void loadContext();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (plan.state !== "ready") {
      setMapScores({ state: "empty" });
      return;
    }
    let active = true;
    const loadScores = async () => {
      setMapScores(loading);
      try {
        const payload = await api.predictionMapScores(startDate);
        if (active) setMapScores({ state: "ready", data: payload });
      } catch (reason) {
        if (active) setMapScores({ state: "error", error: errorText(reason) });
      }
    };
    void loadScores();
    return () => {
      active = false;
    };
  }, [startDate, plan.state]);

  useEffect(() => {
    if (!focus) {
      setHelpOutlook({ state: "empty" });
      return;
    }
    let active = true;
    const loadHelp = async () => {
      setHelpOutlook(loading);
      try {
        const day = await api.helpSummary({
          township_id: focus.townshipId,
          township_name_en: focus.townshipName,
          date: focus.date,
          latitude: focus.latitude,
          longitude: focus.longitude,
        });
        if (active) setHelpOutlook({ state: "ready", data: day });
      } catch (reason) {
        if (active) setHelpOutlook({ state: "error", error: errorText(reason) });
      }
    };
    void loadHelp();
    return () => {
      active = false;
    };
  }, [focus]);

  const runPlan = async () => {
    setPlan(loading);
    try {
      const result = await api.allocationPlan(planRequestBody(startDate, focus));
      setPlan({ state: "ready", data: result });
      await refreshInventory();
    } catch (reason) {
      setPlan({ state: "error", error: errorText(reason) });
    }
  };

  const submitPlan = async (event?: FormEvent) => {
    event?.preventDefault();
    await runPlan();
  };

  const highRiskScores = useMemo(() => {
    return (mapScores.data?.scores ?? []).filter(
      (score) => score.probability_risk_level === "high" || score.probability_risk_level === "severe",
    );
  }, [mapScores.data]);

  const planRows = plan.data?.rows ?? [];
  const highSeverityPlanRows = useMemo(
    (): AllocationTownshipRow[] => planRows.filter((row) => isHighOrSeverePriority(row.priority)),
    [planRows],
  );

  const mapStops = useMemo((): MapStop[] => {
    const depots =
      plan.data?.warehouses?.length === 2
        ? plan.data.warehouses.map((warehouse) => ({
            id: warehouse.id,
            name: warehouse.name,
            latitude: warehouse.latitude,
            longitude: warehouse.longitude,
            kind: (warehouse.region === "east" ? "depot-east" : "depot-west") as MapStop["kind"],
          }))
        : DEFAULT_DEPOTS;
    const seen = new Set<string>(depots.map((stop) => stop.id));
    const stops: MapStop[] = [...depots];

    if (!focus) {
      for (const score of highRiskScores) {
        if (seen.has(score.township_id)) continue;
        seen.add(score.township_id);
        stops.push({
          id: score.township_id,
          name: score.township_name,
          latitude: score.latitude,
          longitude: score.longitude,
          kind: "risk-township",
        });
      }
    } else if (!seen.has(focus.townshipId)) {
      seen.add(focus.townshipId);
      stops.push({
        id: focus.townshipId,
        name: focus.townshipName,
        latitude: focus.latitude,
        longitude: focus.longitude,
        kind: "township",
      });
    }

    for (const row of highSeverityPlanRows) {
      if (seen.has(row.township_id)) continue;
      seen.add(row.township_id);
      stops.push({
        id: row.township_id,
        name: row.township_name,
        latitude: row.latitude,
        longitude: row.longitude,
        kind: "township",
      });
    }
    return stops;
  }, [plan.data, highRiskScores, highSeverityPlanRows, focus]);

  const mapPaths = useMemo((): MapRoutePath[] => {
    const routes = plan.data?.routes ?? [];
    const visible = focus
      ? routes.filter((route) => route.stop_count > 0 && route.stop_count <= 1)
      : routes.filter((route) => route.stop_count > 0);
    return visible.map((route) => ({
      path: route.path,
      depotRegion: route.depot_region ?? "east",
    }));
  }, [plan.data, focus]);

  const mapCenter = useMemo<[number, number]>(() => [17.8, 95.95], []);

  const focusRow = focus
    ? highSeverityPlanRows.find((row) => row.township_id === focus.townshipId)
    : undefined;

  const focusTownshipCensus = useMemo(
    () => findTownshipCensus(census.data, focus?.townshipName ?? ""),
    [census.data, focus?.townshipName],
  );

  const rawAffected =
    helpOutlook.data?.expected_affected_people ??
    focus?.expectedAffected ??
    focusRow?.population ??
    0;

  const displayAffected = useMemo(() => {
    if (focusRow?.population != null && plan.state === "ready") {
      return focusRow.population;
    }
    if (focus) {
      return demoAffectedPeople(focus.townshipId, focus.date, rawAffected);
    }
    return rawAffected;
  }, [focus, focusRow, plan.state, rawAffected]);

  const sexSplit = useMemo(() => {
    if (focusRow?.affected_male != null && focusRow.affected_female != null && plan.state === "ready") {
      return {
        total: focusRow.population,
        male: focusRow.affected_male,
        female: focusRow.affected_female,
      };
    }
    if (!focusTownshipCensus) {
      return splitAffectedBySex(displayAffected, 0, 0);
    }
    return splitAffectedBySex(
      displayAffected,
      focusTownshipCensus.population.male,
      focusTownshipCensus.population.female,
    );
  }, [displayAffected, focusTownshipCensus, focusRow, plan.state]);

  const inventoryError =
    inventoryEast.state === "error"
      ? inventoryEast.error
      : inventoryWest.state === "error"
        ? inventoryWest.error
        : undefined;

  const dispatchPreview = highSeverityPlanRows.slice(0, 8);

  const priorityScopeLabel = focus
    ? `${riskLabel(focus.riskLevel)} risk`
    : "High and severe only";

  const visibleDepotRegions = useMemo((): RegionCode[] => {
    if (focus) {
      return [depotRegionForCoordinates(focus.latitude, focus.longitude)];
    }
    if (focusRow?.depot_region) {
      return [focusRow.depot_region];
    }
    return ["east", "west"];
  }, [focus, focusRow?.depot_region]);

  return (
    <main className="allocation-board allocation-board-single">
      <section className="panel allocation-map-column">
        <div className="section-heading">
          <div>
            <h2>Route map</h2>
          </div>
          <span className="source">
            {focus
              ? `${focus.townshipName} · ${focus.date} · depot → township`
              : "East depot Bago · west depot Pyay"}
          </span>
        </div>
        <RouteMap
          center={mapCenter}
          stops={mapStops}
          paths={mapPaths}
          focusTownshipId={focus?.townshipId}
        />
        <ul className="allocation-route-legend">
          {(focus
            ? (plan.data?.routes ?? []).filter((route) => route.stop_count === 1)
            : (plan.data?.routes ?? []).filter((route) => route.stop_count > 0)
          ).map((route) => (
            <li key={`${route.depot_region}-${route.route_id}`}>
              <strong>{route.route_id}</strong> · {depotLabel(route.depot_region)} ·{" "}
              {focus ? "depot → focus township" : `${route.stop_count} stops`} ·{" "}
              {route.routing_method === "osrm_road" ? "OSRM road route" : "Straight-line fallback (OSRM unavailable)"}
            </li>
          ))}
          {!plan.data?.routes.length ? (
            <li className="hint">
              {focus
                ? "Create plan to draw one route from the nearest depot (east Bago / west Pyay) to this township."
                : "Create plan to draw depot → township routes (nearest-neighbor order)."}
            </li>
          ) : null}
        </ul>
      </section>

      <section className="allocation-rail">
        <article className="panel allocation-people-panel allocation-rail-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Prediction</p>
              <h2>Affected population</h2>
            </div>
            {focus ? (
              <button type="button" className="text-link" onClick={onClearFocus}>
                All townships
              </button>
            ) : null}
          </div>
          {focus ? (
            <div className="allocation-focus-card">
              <p className="eyebrow">{focus.date}</p>
              <h3>{focus.townshipName}</h3>
              {helpOutlook.state === "loading" && !focus.expectedAffected ? (
                <p className="state">Loading help estimate…</p>
              ) : null}
              {helpOutlook.state === "error" && !focus.expectedAffected ? (
                <p className="state error">Help estimate unavailable: {helpOutlook.error}</p>
              ) : null}
              <div className="allocation-sex-grid" aria-label="Estimated affected population by sex">
                <div>
                  <span>Total affected</span>
                  <strong>{sexSplit.total.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Male</span>
                  <strong>{sexSplit.male.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Female</span>
                  <strong>{sexSplit.female.toLocaleString()}</strong>
                </div>
              </div>
            </div>
          ) : (
            <p className="hint">
              On <strong>Flood Prediction</strong>, pick a township on the map with <strong>high</strong> or{" "}
              <strong>severe</strong> risk, then use <strong>Plan resource allocation</strong> to open a focused
              route here.
            </p>
          )}
          {plan.state === "error" && <p className="state error">Plan failed: {plan.error}</p>}
        </article>

        <article className="panel allocation-stock-panel allocation-rail-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Inventory</p>
              <h2>In stock</h2>
            </div>
          </div>
          {inventoryError ? <p className="state error">Inventory unavailable: {inventoryError}</p> : null}
          <div
            className={`allocation-stock-grid allocation-stock-compact${visibleDepotRegions.length === 1 ? " allocation-stock-single" : ""}`}
          >
            {visibleDepotRegions.map((region) => {
              const snapshot = region === "east" ? inventoryEast.data : inventoryWest.data;
              const lines = (snapshot?.classes ?? []).flatMap((klass) =>
                klass.items
                  .filter((item) => item.quantity > 0)
                  .map((item) => ({ klass, item })),
              );
              return (
                <div key={region} className="allocation-stock-depot">
                  <h3>{depotLabel(region)}</h3>
                  <ul>
                    {lines.map(({ klass, item }) => (
                      <li key={`${region}:${klass.code}:${item.code ?? "fund"}`}>
                        <span>{item.name}</span>
                        <span>
                          {item.quantity.toLocaleString()} {item.unit}
                        </span>
                      </li>
                    ))}
                    {!lines.length ? <li className="state">No stock</li> : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel allocation-table-panel allocation-rail-panel allocation-dispatch-panel">
          <div className="section-heading allocation-dispatch-head">
            <h2>Allocation plan</h2>
            <div className="allocation-priority-side">
              <span className="field-label">Priority scope</span>
              <strong className="allocation-priority-value">{priorityScopeLabel}</strong>
            </div>
          </div>
          <form className="allocation-plan-form" onSubmit={submitPlan}>
            <button type="submit" className="allocation-action primary" disabled={plan.state === "loading"}>
              {plan.state === "loading" ? "Planning…" : "Create plan & dispatch"}
            </button>
          </form>
          {onOpenInventory ? (
            <p className="allocation-inventory-link">
              <button type="button" className="text-link" onClick={onOpenInventory}>
                Open inventory
              </button>
            </p>
          ) : null}
          {plan.data?.shortages.length ? (
            <p className="allocation-alert" role="status">
              Stock shortage on {plan.data.shortages.length} line
              {plan.data.shortages.length === 1 ? "" : "s"}.
            </p>
          ) : null}
          {plan.state === "loading" ? <p className="state allocation-plan-status">Building plan and updating stock…</p> : null}
          <div className="allocation-dispatch-scroll">
            <div className="history-table allocation-table allocation-table-compact" role="table">
              <div className="history-row allocation header" role="row">
                <span>Township</span>
                <span>Depot</span>
                <span>People</span>
                <span>Route</span>
              </div>
              {dispatchPreview.map((row) => (
                <div className="history-row allocation" role="row" key={row.township_id}>
                  <strong>{row.township_name}</strong>
                  <span>{depotLabel(row.depot_region)}</span>
                  <span>{row.population.toLocaleString()}</span>
                  <span>{row.route_id}</span>
                </div>
              ))}
              {!dispatchPreview.length && plan.state === "ready" ? (
                <p className="state">No townships met the priority threshold.</p>
              ) : null}
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

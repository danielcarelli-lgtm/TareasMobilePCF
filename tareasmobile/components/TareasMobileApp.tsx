import * as React from "react";
import {
    SearchBox,
    Icon,
    IconButton,
    Spinner,
    SpinnerSize,
    PrimaryButton,
    DefaultButton,
    Dialog,
    DialogFooter,
    DialogType
} from "@fluentui/react";

export interface TareasMobileAppProps {
    dataset: ComponentFramework.PropertyTypes.DataSet;
    webAPI: ComponentFramework.WebApi;
    navigation: ComponentFramework.Navigation;
    refreshData: () => void;
}

interface TareaItem {
    id: string;
    name: string;
    idtarea: string;
    statecode: number;
    statuscode: number;
    statusLabel: string;
    inicio: Date | undefined;
    fin: Date | undefined;
    esfuerzoEstimado: number;
    horasImputadas: number;
    progreso: number;
    tareaPadre: string;
    descripcion: string;
    proyectoNum: string;
}

interface ResumenProductos {
    pendientes: number;
    instalados: number;
    devueltos: number;
}

const STATUS_CODE = {
    pending: 1,
    inactive: 2,
    inProgress: 919690001,
    completed: 919690002
} as const;

const EMPTY_PRODUCT_SUMMARY: ResumenProductos = {
    pendientes: 0,
    instalados: 0,
    devueltos: 0
};

const normalizeRecordId = (id: string): string => id.replace(/[{}]/g, "").toLowerCase();

const getProductStatusLabel = (record: ComponentFramework.WebApi.Entity): string => {
    const formattedValue: unknown = record["sec_estadodelproducto@OData.Community.Display.V1.FormattedValue"];
    return typeof formattedValue === "string" ? formattedValue.toLowerCase() : "";
};

const safeGetString = (
    record: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
    columnName: string,
    fallback = ""
): string => {
    try {
        const formatted = record.getFormattedValue(columnName);
        if (formatted) return formatted;
        const raw = record.getValue(columnName);
        if (typeof raw === "string") return raw;
        if (typeof raw === "number") return String(raw);
    } catch {
        // Ignorar si la columna no está en la vista actual
    }
    return fallback;
};

const safeGetNumber = (
    record: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
    columnName: string,
    fallback = 0
): number => {
    try {
        const raw = record.getValue(columnName);
        if (typeof raw === "number" && !isNaN(raw)) return raw;
        if (typeof raw === "string" && raw.trim() !== "") {
            const parsed = Number(raw);
            if (!isNaN(parsed)) return parsed;
        }
    } catch {
        // Ignorar si la columna no está en la vista actual
    }
    return fallback;
};

const safeGetDate = (
    record: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
    columnName: string
): Date | undefined => {
    try {
        const raw = record.getValue(columnName);
        if (!raw) return undefined;
        if (raw instanceof Date) return raw;
        if (typeof raw === "string" || typeof raw === "number") {
            const d = new Date(raw);
            return isNaN(d.getTime()) ? undefined : d;
        }
    } catch {
        // Ignorar si la columna no está en la vista actual
    }
    return undefined;
};

const getScheduleStatus = (
    inicio: Date | undefined,
    fin: Date | undefined,
    today: Date
): { text: string; color: string } | undefined => {
    if (!inicio || !fin) return undefined;

    const toCalendarDay = (date: Date): number =>
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const daysUntilStart = Math.ceil((toCalendarDay(inicio) - toCalendarDay(today)) / millisecondsPerDay);
    const daysUntilEnd = Math.ceil((toCalendarDay(fin) - toCalendarDay(today)) / millisecondsPerDay);

    if (daysUntilStart > 0) {
        return { text: `Aún faltan ${daysUntilStart} días para el inicio`, color: "#0078d4" };
    }
    if (daysUntilEnd >= 0) {
        return { text: `Faltan ${daysUntilEnd} días para finalizar la tarea`, color: "#107c10" };
    }
    return { text: `Vencida por ${Math.abs(daysUntilEnd)} días`, color: "#a4262c" };
};

export const TareasMobileApp: React.FC<TareasMobileAppProps> = ({ dataset, webAPI, navigation, refreshData }) => {
    const [searchTerm, setSearchTerm] = React.useState<string>("");
    const [selectedFilter, setSelectedFilter] = React.useState<string>("all");
    const [updatingId, setUpdatingId] = React.useState<string | null>(null);
    const [expandedId, setExpandedId] = React.useState<string | null>(null);
    const [progressDrafts, setProgressDrafts] = React.useState<Record<string, number>>({});
    const [confirmCompleteId, setConfirmCompleteId] = React.useState<string | null>(null);
    const [resumenProductos, setResumenProductos] = React.useState<Record<string, ResumenProductos>>({});
    const [errorResumenProductos, setErrorResumenProductos] = React.useState(false);

    const tareas: TareaItem[] = React.useMemo(() => {
        if (!dataset || dataset.loading || !dataset.sortedRecordIds) return [];

        const foundCol = dataset.columns?.find((c) => c.name.endsWith(".sec_numerodeproyecto"));
        const proyectoNumCol = foundCol ? foundCol.name : "a_68c5f551b320412b99fdb34e6b8d2dac.sec_numerodeproyecto";

        return dataset.sortedRecordIds
            .map((id) => {
                const record = dataset.records[id];
                if (!record) return null;

                const linkedProyNum = safeGetString(record, proyectoNumCol, "");
                const proyNum = linkedProyNum !== "" ? linkedProyNum : safeGetString(record, "sec_proyectoid", "S/P");

                return {
                    id: record.getRecordId(),
                    name: safeGetString(record, "sec_name", "Sin nombre"),
                    idtarea: safeGetString(record, "sec_idtarea", ""),
                    statecode: safeGetNumber(record, "statecode", 0),
                    statuscode: safeGetNumber(record, "statuscode", STATUS_CODE.pending),
                    statusLabel: safeGetString(record, "statuscode", "Pendiente"),
                    inicio: safeGetDate(record, "sec_inicio"),
                    fin: safeGetDate(record, "sec_fin"),
                    esfuerzoEstimado: safeGetNumber(record, "sec_esfuerzoestimado", 0),
                    horasImputadas: safeGetNumber(record, "sec_horasimputadas", 0),
                    progreso: safeGetNumber(record, "sec_progreso", 0),
                    tareaPadre: safeGetString(record, "sec_tareaprincipalid", "Sin tarea padre"),
                    descripcion: safeGetString(record, "sec_descripcion", "Sin descripción técnica adicional."),
                    proyectoNum: proyNum
                };
            })
            .filter((item): item is TareaItem => item !== null);
    }, [dataset, dataset?.loading, dataset?.sortedRecordIds, dataset?.records]);

    React.useEffect(() => {
        const tareaIds = Array.from(
            new Set(
                tareas
                    .map((tarea) => normalizeRecordId(tarea.id))
                    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
            )
        );
        let cancelled = false;

        setResumenProductos({});
        setErrorResumenProductos(false);
        if (tareaIds.length === 0) return;

        const cargarResumenProductos = async (): Promise<void> => {
            const condiciones = tareaIds
                .map((id) => `<condition attribute="sec_tareadeproyectoid" operator="eq" value="${id}" />`)
                .join("");
            const fetchXml = [
                '<fetch version="1.0" mapping="logical" no-lock="false" distinct="true">',
                '<entity name="sec_lineadeproductodeproyecto">',
                '<attribute name="statecode" />',
                '<attribute name="sec_lineadeproductodeproyectoid" />',
                '<attribute name="sec_name" />',
                '<attribute name="sec_estadodelproducto" />',
                '<attribute name="sec_numerodeserie" />',
                '<attribute name="sec_descripciondelaubicacion" />',
                '<attribute name="sec_productodeproyectoid" />',
                '<attribute name="sec_tareadeproyectoid" />',
                '<order attribute="sec_name" descending="false" />',
                '<filter type="and">',
                '<condition attribute="statecode" operator="eq" value="0" />',
                `<filter type="or">${condiciones}</filter>`,
                "</filter>",
                "</entity>",
                "</fetch>"
            ].join("");

            try {
                const nextSummaries: Record<string, ResumenProductos> = {};
                let response = await webAPI.retrieveMultipleRecords(
                    "sec_lineadeproductodeproyecto",
                    `?fetchXml=${encodeURIComponent(fetchXml)}`,
                    5000
                );

                while (true) {
                    response.entities.forEach((record) => {
                        const taskId: unknown = record._sec_tareadeproyectoid_value;
                        if (typeof taskId !== "string") return;
                        const normalizedTaskId = normalizeRecordId(taskId);
                        const summary = nextSummaries[normalizedTaskId] ?? { ...EMPTY_PRODUCT_SUMMARY };
                        const status = getProductStatusLabel(record);

                        if (status.includes("pend")) summary.pendientes += 1;
                        else if (status.includes("instal")) summary.instalados += 1;
                        else if (status.includes("devuelt")) summary.devueltos += 1;

                        nextSummaries[normalizedTaskId] = summary;
                    });

                    if (!response.nextLink) break;
                    response = await webAPI.retrieveMultipleRecords(
                        "sec_lineadeproductodeproyecto",
                        response.nextLink,
                        5000
                    );
                }

                if (!cancelled) setResumenProductos(nextSummaries);
            } catch (error) {
                if (!cancelled) {
                    console.error("Error al cargar el resumen de productos de las tareas:", error);
                    setErrorResumenProductos(true);
                }
            }
        };

        void cargarResumenProductos();
        return () => {
            cancelled = true;
        };
    }, [tareas, webAPI]);

    const filteredTareas = React.useMemo(() => {
        return tareas.filter((t) => {
            const matchesSearch =
                t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.idtarea.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.proyectoNum.toLowerCase().includes(searchTerm.toLowerCase());

            if (selectedFilter === "all") return matchesSearch;
            if (selectedFilter === "in_progress") return matchesSearch && t.statuscode === STATUS_CODE.inProgress;
            if (selectedFilter === "pending") return matchesSearch && t.statuscode === STATUS_CODE.pending;
            return matchesSearch;
        });
    }, [tareas, searchTerm, selectedFilter]);

    const handleUpdateStatus = async (id: string, newStatusCode: number): Promise<boolean> => {
        setUpdatingId(id);
        try {
            await webAPI.updateRecord("sec_tarea", id, {
                statuscode: newStatusCode
            });
            refreshData();
            return true;
        } catch (error) {
            console.error("Error al actualizar la tarea:", error);
            return false;
        } finally {
            setUpdatingId(null);
        }
    };

    const handleSaveProgress = async (id: string): Promise<void> => {
        const progress = progressDrafts[id];
        if (typeof progress !== "number") return;

        setUpdatingId(id);
        try {
            await webAPI.updateRecord("sec_tarea", id, {
                sec_progreso: progress
            });
            setProgressDrafts((drafts) => {
                const updatedDrafts = { ...drafts };
                delete updatedDrafts[id];
                return updatedDrafts;
            });
            refreshData();
        } catch (error) {
            console.error("Error al actualizar el progreso de la tarea:", error);
        } finally {
            setUpdatingId(null);
        }
    };

    const handleConfirmComplete = async (): Promise<void> => {
        if (!confirmCompleteId) return;
        const completed = await handleUpdateStatus(confirmCompleteId, STATUS_CODE.completed);
        if (completed) setConfirmCompleteId(null);
    };

    const handleOpenTask = async (id: string): Promise<void> => {
        try {
            await navigation.openForm({ entityName: "sec_tarea", entityId: id });
        } catch (error) {
            console.error("Error al abrir el formulario de la tarea:", error);
        }
    };

    if (!dataset || dataset.loading) {
        return (
            <div className="tm-loading-container">
                <Spinner size={SpinnerSize.large} label="Cargando tareas de campo..." />
            </div>
        );
    }

    return (
        <div className="tareasmobile-main-container">
            <div className="tm-mobile-wrapper">
                <div className="tm-header-section">
                    <div className="tm-app-title">
                        <Icon iconName="TaskManager" className="tm-title-icon" />
                        <span>Mis Tareas de Campo</span>
                        <span className="tm-badge-count">{filteredTareas.length}</span>
                    </div>
                    <SearchBox
                        placeholder="Buscar tarea, ID o proyecto..."
                        value={searchTerm}
                        onChange={(_, val) => {
                            setSearchTerm(typeof val === "string" ? val : "");
                        }}
                        className="tm-search-box"
                    />
                    <div className="tm-filter-chips">
                        <button
                            type="button"
                            className={`tm-chip ${selectedFilter === "all" ? "active" : ""}`}
                            onClick={() => {
                                setSelectedFilter("all");
                            }}
                        >
                            Todas
                        </button>
                        <button
                            type="button"
                            className={`tm-chip ${selectedFilter === "pending" ? "active" : ""}`}
                            onClick={() => {
                                setSelectedFilter("pending");
                            }}
                        >
                            Pendientes
                        </button>
                        <button
                            type="button"
                            className={`tm-chip ${selectedFilter === "in_progress" ? "active" : ""}`}
                            onClick={() => {
                                setSelectedFilter("in_progress");
                            }}
                        >
                            En Curso
                        </button>
                    </div>
                </div>

                <div className="tm-cards-container">
                    {filteredTareas.length === 0 ? (
                        <div className="tm-no-records">
                            <Icon iconName="Inbox" className="tm-empty-icon" />
                            <p>No se encontraron tareas asignadas</p>
                        </div>
                    ) : (
                        filteredTareas.map((tarea) => {
                            const isExpanded = expandedId === tarea.id;
                            const isUpdating = updatingId === tarea.id;
                            const displayedProgress = Math.max(
                                0,
                                Math.min(progressDrafts[tarea.id] ?? tarea.progreso, 100)
                            );
                            const scheduleStatus = getScheduleStatus(tarea.inicio, tarea.fin, new Date());
                            const resumenProductosTarea =
                                resumenProductos[normalizeRecordId(tarea.id)] ?? EMPTY_PRODUCT_SUMMARY;

                            return (
                                <div key={tarea.id} className={`tm-card ${isExpanded ? "expanded" : ""}`}>
                                    <div
                                        className="tm-card-top"
                                        onClick={() => {
                                            setExpandedId(isExpanded ? null : tarea.id);
                                        }}
                                    >
                                        <div className="tm-card-meta-top">
                                            <span className="tm-project-tag">
                                                <Icon iconName="ProjectCollection" /> {tarea.proyectoNum}
                                            </span>
                                            <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column" }}>
                                                <span className={`tm-status-pill status-${tarea.statuscode}`}>
                                                    {tarea.statusLabel}
                                                </span>
                                                {scheduleStatus && (
                                                    <span
                                                        style={{
                                                            color: scheduleStatus.color,
                                                            fontSize: 12,
                                                            fontWeight: 600,
                                                            marginTop: 4
                                                        }}
                                                    >
                                                        {scheduleStatus.text}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="tm-card-title-row">
                                            <span className="tm-task-id">{tarea.idtarea}</span>
                                            <h3 className="tm-task-name">{tarea.name}</h3>
                                            <IconButton
                                                iconProps={{ iconName: "Edit" }}
                                                title={`Abrir formulario de ${tarea.name}`}
                                                ariaLabel={`Abrir formulario de ${tarea.name}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void handleOpenTask(tarea.id);
                                                }}
                                            />
                                        </div>
                                        <div className="tm-card-preview-info">
                                            <span>
                                                <Icon iconName="Clock" /> {tarea.horasImputadas}h / {tarea.esfuerzoEstimado}h est.
                                            </span>
                                            {errorResumenProductos ? (
                                                <span className="tm-product-summary-error">Resumen de productos no disponible</span>
                                            ) : (
                                                <div
                                                    className="tm-product-summary"
                                                    aria-label={`Productos de ${tarea.name}: ${resumenProductosTarea.pendientes} pendientes, ${resumenProductosTarea.instalados} instalados y ${resumenProductosTarea.devueltos} devueltos`}
                                                >
                                                    <span className="tm-product-count product-pending">
                                                        Pendientes {resumenProductosTarea.pendientes}
                                                    </span>
                                                    <span className="tm-product-count product-installed">
                                                        Instalados {resumenProductosTarea.instalados}
                                                    </span>
                                                    <span className="tm-product-count product-returned">
                                                        Devueltos {resumenProductosTarea.devueltos}
                                                    </span>
                                                </div>
                                            )}
                                            <span className="tm-expand-indicator">
                                                <Icon iconName={isExpanded ? "ChevronUp" : "ChevronDown"} />
                                            </span>
                                        </div>
                                    </div>

                                    <div
                                        className="tm-progress-bar-container"
                                        role="progressbar"
                                        aria-label={`Progreso de ${tarea.name}`}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={displayedProgress}
                                        aria-valuetext={`${displayedProgress}%`}
                                        style={{
                                            backgroundColor: "#e1e1e1",
                                            borderRadius: 4,
                                            height: 8,
                                            margin: "8px 0",
                                            overflow: "hidden"
                                        }}
                                    >
                                        <div
                                            className="tm-progress-fill"
                                            style={{
                                                backgroundColor: "#107c10",
                                                height: "100%",
                                                transition: "width 160ms ease",
                                                width: `${displayedProgress}%`
                                            }}
                                        />
                                    </div>

                                    {isExpanded && (
                                        <div className="tm-card-details-panel">
                                            <div className="tm-detail-row">
                                                <strong>Tarea padre:</strong>
                                                <p>{tarea.tareaPadre}</p>
                                            </div>
                                            <div className="tm-detail-row">
                                                <strong>Descripción:</strong>
                                                <p>{tarea.descripcion}</p>
                                            </div>
                                            <div style={{ margin: "16px 0" }}>
                                                <label
                                                    htmlFor={`tm-progress-${tarea.id}`}
                                                    style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}
                                                >
                                                    <strong>Progreso</strong>
                                                    <span>{displayedProgress}%</span>
                                                </label>
                                                <input
                                                    id={`tm-progress-${tarea.id}`}
                                                    type="range"
                                                    min={0}
                                                    max={100}
                                                    step={1}
                                                    value={displayedProgress}
                                                    aria-label={`Progreso de ${tarea.name}`}
                                                    disabled={isUpdating}
                                                    onChange={(event) => {
                                                        const progress = Number(event.currentTarget.value);
                                                        setProgressDrafts((drafts) => ({
                                                            ...drafts,
                                                            [tarea.id]: progress
                                                        }));
                                                    }}
                                                    style={{
                                                        background: `linear-gradient(to right, #1769aa 0%, #1769aa ${displayedProgress}%, #d1d5dc ${displayedProgress}%, #d1d5dc 100%) center / 100% 6px no-repeat`
                                                    }}
                                                />
                                                <DefaultButton
                                                    text="Guardar progreso"
                                                    iconProps={{ iconName: "Save" }}
                                                    disabled={
                                                        isUpdating ||
                                                        progressDrafts[tarea.id] === undefined ||
                                                        displayedProgress === Math.max(0, Math.min(tarea.progreso, 100))
                                                    }
                                                    onClick={() => {
                                                        void handleSaveProgress(tarea.id);
                                                    }}
                                                    style={{ marginTop: 8 }}
                                                />
                                            </div>
                                            <div className="tm-detail-dates">
                                                <div>
                                                    <small>Inicio:</small>
                                                    <span>{tarea.inicio ? tarea.inicio.toLocaleDateString() : "No definida"}</span>
                                                </div>
                                                <div>
                                                    <small>Fin:</small>
                                                    <span>{tarea.fin ? tarea.fin.toLocaleDateString() : "No definida"}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="tm-card-footer">
                                        {isUpdating ? (
                                            <Spinner size={SpinnerSize.small} label="Actualizando..." />
                                        ) : (
                                            <>
                                                {tarea.statuscode === STATUS_CODE.pending && (
                                                    <PrimaryButton
                                                        text="Iniciar Tarea"
                                                        iconProps={{ iconName: "Play" }}
                                                        className="tm-action-btn btn-start"
                                                        onClick={() => {
                                                            void handleUpdateStatus(tarea.id, STATUS_CODE.inProgress);
                                                        }}
                                                    />
                                                )}
                                                {tarea.statuscode === STATUS_CODE.inProgress && (
                                                    <DefaultButton
                                                        text="Pausar / Pendiente"
                                                        iconProps={{ iconName: "Pause" }}
                                                        className="tm-action-btn btn-pause"
                                                        onClick={() => {
                                                            void handleUpdateStatus(tarea.id, STATUS_CODE.pending);
                                                        }}
                                                    />
                                                )}
                                                {tarea.statuscode === STATUS_CODE.inProgress && (
                                                    <PrimaryButton
                                                        text="Completar Tarea"
                                                        iconProps={{ iconName: "CheckMark" }}
                                                        className="tm-action-btn btn-complete"
                                                        onClick={() => {
                                                            setConfirmCompleteId(tarea.id);
                                                        }}
                                                    />
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <Dialog
                    hidden={!confirmCompleteId}
                    onDismiss={() => {
                        setConfirmCompleteId(null);
                    }}
                    dialogContentProps={{
                        type: DialogType.normal,
                        title: "Completar tarea",
                        subText: "¿Estás seguro de que quieres completar esta tarea? ¿Ya cargaste todas las horas de la tarea?"
                    }}
                    modalProps={{ isBlocking: updatingId === confirmCompleteId }}
                >
                    <DialogFooter>
                        <PrimaryButton
                            text="Completar"
                            onClick={() => {
                                void handleConfirmComplete();
                            }}
                            disabled={!confirmCompleteId || updatingId === confirmCompleteId}
                        />
                        <DefaultButton
                            text="Cancelar"
                            onClick={() => {
                                setConfirmCompleteId(null);
                            }}
                            disabled={updatingId === confirmCompleteId}
                        />
                    </DialogFooter>
                </Dialog>

                <div className="tm-version-tag">v0.0.12</div>
            </div>
        </div>
    );
};
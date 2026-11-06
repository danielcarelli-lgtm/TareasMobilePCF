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
    resources?: ComponentFramework.Resources;
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
    today: Date,
    t: (key: string, fallback: string) => string
): { text: string; color: string } | undefined => {
    if (!inicio || !fin) return undefined;

    const toCalendarDay = (date: Date): number =>
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const daysUntilStart = Math.ceil((toCalendarDay(inicio) - toCalendarDay(today)) / millisecondsPerDay);
    const daysUntilEnd = Math.ceil((toCalendarDay(fin) - toCalendarDay(today)) / millisecondsPerDay);

    if (daysUntilStart > 0) {
        return { text: `${t("Msg_DaysToStart1", "Aún faltan ")}${daysUntilStart}${t("Msg_DaysToStart2", " días para el inicio")}`, color: "#0078d4" };
    }
    if (daysUntilEnd >= 0) {
        return { text: `${t("Msg_DaysToEnd1", "Faltan ")}${daysUntilEnd}${t("Msg_DaysToEnd2", " días para finalizar la tarea")}`, color: "#107c10" };
    }
    return { text: `${t("Msg_Overdue1", "Vencida por ")}${Math.abs(daysUntilEnd)}${t("Msg_Overdue2", " días")}`, color: "#a4262c" };
};

export const TareasMobileApp: React.FC<TareasMobileAppProps> = ({ dataset, webAPI, navigation, resources, refreshData }) => {
    const [searchTerm, setSearchTerm] = React.useState<string>("");
    const [selectedFilter, setSelectedFilter] = React.useState<string>("all");
    const [updatingId, setUpdatingId] = React.useState<string | null>(null);
    const [expandedId, setExpandedId] = React.useState<string | null>(null);
    const [progressDrafts, setProgressDrafts] = React.useState<Record<string, number>>({});
    const [confirmCompleteId, setConfirmCompleteId] = React.useState<string | null>(null);
    const [resumenProductos, setResumenProductos] = React.useState<Record<string, ResumenProductos>>({});
    const [errorResumenProductos, setErrorResumenProductos] = React.useState(false);

    const t = React.useCallback(
        (key: string, defaultValue: string): string => {
            if (resources && typeof resources.getString === "function") {
                const val = resources.getString(key);
                if (val && val !== key) {
                    return val;
                }
            }
            return defaultValue;
        },
        [resources]
    );

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
                    name: safeGetString(record, "sec_name", t("Label_NoName", "Sin nombre")),
                    idtarea: safeGetString(record, "sec_idtarea", ""),
                    statecode: safeGetNumber(record, "statecode", 0),
                    statuscode: safeGetNumber(record, "statuscode", STATUS_CODE.pending),
                    statusLabel: safeGetString(record, "statuscode", t("Status_Pending", "Pendiente")),
                    inicio: safeGetDate(record, "sec_inicio"),
                    fin: safeGetDate(record, "sec_fin"),
                    esfuerzoEstimado: safeGetNumber(record, "sec_esfuerzoestimado", 0),
                    horasImputadas: safeGetNumber(record, "sec_horasimputadas", 0),
                    progreso: safeGetNumber(record, "sec_progreso", 0),
                    tareaPadre: safeGetString(record, "sec_tareaprincipalid", t("Label_NoParent", "Sin tarea padre")),
                    descripcion: safeGetString(record, "sec_descripcion", t("Label_NoDescription", "Sin descripción técnica adicional.")),
                    proyectoNum: proyNum
                };
            })
            .filter((item): item is TareaItem => item !== null);
    }, [dataset, dataset?.loading, dataset?.sortedRecordIds, dataset?.records, t]);

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
        return tareas.filter((tItem) => {
            const matchesSearch =
                tItem.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                tItem.idtarea.toLowerCase().includes(searchTerm.toLowerCase()) ||
                tItem.proyectoNum.toLowerCase().includes(searchTerm.toLowerCase());

            if (selectedFilter === "all") return matchesSearch;
            if (selectedFilter === "in_progress") return matchesSearch && tItem.statuscode === STATUS_CODE.inProgress;
            if (selectedFilter === "pending") return matchesSearch && tItem.statuscode === STATUS_CODE.pending;
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
                <Spinner size={SpinnerSize.large} label={t("Label_Loading", "Cargando tareas de campo...")} />
            </div>
        );
    }

    return (
        <div className="tareasmobile-main-container">
            <div className="tm-mobile-wrapper">
                <div className="tm-header-section">
                    <div className="tm-app-title">
                        <Icon iconName="TaskManager" className="tm-title-icon" />
                        <span>{t("Title_App", "Mis Tareas de Campo")}</span>
                        <span className="tm-badge-count">{filteredTareas.length}</span>
                    </div>
                    <SearchBox
                        placeholder={t("Placeholder_Search", "Buscar tarea, ID o proyecto...")}
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
                            {t("Filter_All", "Todas")}
                        </button>
                        <button
                            type="button"
                            className={`tm-chip ${selectedFilter === "pending" ? "active" : ""}`}
                            onClick={() => {
                                setSelectedFilter("pending");
                            }}
                        >
                            {t("Filter_Pending", "Pendientes")}
                        </button>
                        <button
                            type="button"
                            className={`tm-chip ${selectedFilter === "in_progress" ? "active" : ""}`}
                            onClick={() => {
                                setSelectedFilter("in_progress");
                            }}
                        >
                            {t("Filter_InProgress", "En Curso")}
                        </button>
                    </div>
                </div>

                <div className="tm-cards-container">
                    {filteredTareas.length === 0 ? (
                        <div className="tm-no-records">
                            <Icon iconName="Inbox" className="tm-empty-icon" />
                            <p>{t("Label_NoRecords", "No se encontraron tareas asignadas")}</p>
                        </div>
                    ) : (
                        filteredTareas.map((tarea) => {
                            const isExpanded = expandedId === tarea.id;
                            const isUpdating = updatingId === tarea.id;
                            const displayedProgress = Math.max(
                                0,
                                Math.min(progressDrafts[tarea.id] ?? tarea.progreso, 100)
                            );
                            const scheduleStatus = getScheduleStatus(tarea.inicio, tarea.fin, new Date(), t);
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
                                                title={`${t("Tooltip_OpenForm", "Abrir formulario de ")}${tarea.name}`}
                                                ariaLabel={`${t("Tooltip_OpenForm", "Abrir formulario de ")}${tarea.name}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void handleOpenTask(tarea.id);
                                                }}
                                            />
                                        </div>
                                        <div className="tm-card-preview-info">
                                            <span>
                                                <Icon iconName="Clock" /> {tarea.horasImputadas}h / {tarea.esfuerzoEstimado}h {t("Label_EstimatedShort", "est.")}
                                            </span>
                                            {errorResumenProductos ? (
                                                <span className="tm-product-summary-error">{t("Label_SummaryError", "Resumen de productos no disponible")}</span>
                                            ) : (
                                                <div
                                                    className="tm-product-summary"
                                                    aria-label={`Productos de ${tarea.name}: ${resumenProductosTarea.pendientes} pendientes, ${resumenProductosTarea.instalados} instalados y ${resumenProductosTarea.devueltos} devueltos`}
                                                >
                                                    <span className="tm-product-count product-pending">
                                                        {t("Label_SummaryPending", "Pendientes")} {resumenProductosTarea.pendientes}
                                                    </span>
                                                    <span className="tm-product-count product-installed">
                                                        {t("Label_SummaryInstalled", "Instalados")} {resumenProductosTarea.instalados}
                                                    </span>
                                                    <span className="tm-product-count product-returned">
                                                        {t("Label_SummaryReturned", "Devueltos")} {resumenProductosTarea.devueltos}
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
                                        aria-label={`${t("Label_Progress", "Progreso")} de ${tarea.name}`}
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
                                                <strong>{t("Label_ParentTask", "Tarea padre:")}</strong>
                                                <p>{tarea.tareaPadre}</p>
                                            </div>
                                            <div className="tm-detail-row">
                                                <strong>{t("Label_Description", "Descripción:")}</strong>
                                                <p>{tarea.descripcion}</p>
                                            </div>
                                            <div style={{ margin: "16px 0" }}>
                                                <label
                                                    htmlFor={`tm-progress-${tarea.id}`}
                                                    style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}
                                                >
                                                    <strong>{t("Label_Progress", "Progreso")}</strong>
                                                    <span>{displayedProgress}%</span>
                                                </label>
                                                <input
                                                    id={`tm-progress-${tarea.id}`}
                                                    type="range"
                                                    min={0}
                                                    max={100}
                                                    step={1}
                                                    value={displayedProgress}
                                                    aria-label={`${t("Label_Progress", "Progreso")} de ${tarea.name}`}
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
                                                    text={t("Btn_SaveProgress", "Guardar progreso")}
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
                                                    <small>{t("Label_StartDate", "Inicio:")}</small>
                                                    <span>{tarea.inicio ? tarea.inicio.toLocaleDateString() : t("Label_UndefinedDate", "No definida")}</span>
                                                </div>
                                                <div>
                                                    <small>{t("Label_EndDate", "Fin:")}</small>
                                                    <span>{tarea.fin ? tarea.fin.toLocaleDateString() : t("Label_UndefinedDate", "No definida")}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="tm-card-footer">
                                        {isUpdating ? (
                                            <Spinner size={SpinnerSize.small} label={t("Label_Updating", "Actualizando...")} />
                                        ) : (
                                            <>
                                                {tarea.statuscode === STATUS_CODE.pending && (
                                                    <PrimaryButton
                                                        text={t("Btn_StartTask", "Iniciar Tarea")}
                                                        iconProps={{ iconName: "Play" }}
                                                        className="tm-action-btn btn-start"
                                                        onClick={() => {
                                                            void handleUpdateStatus(tarea.id, STATUS_CODE.inProgress);
                                                        }}
                                                    />
                                                )}
                                                {tarea.statuscode === STATUS_CODE.inProgress && (
                                                    <DefaultButton
                                                        text={t("Btn_PauseTask", "Pausar / Pendiente")}
                                                        iconProps={{ iconName: "Pause" }}
                                                        className="tm-action-btn btn-pause"
                                                        onClick={() => {
                                                            void handleUpdateStatus(tarea.id, STATUS_CODE.pending);
                                                        }}
                                                    />
                                                )}
                                                {tarea.statuscode === STATUS_CODE.inProgress && (
                                                    <PrimaryButton
                                                        text={t("Btn_CompleteTask", "Completar Tarea")}
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
                        title: t("Dialog_Complete_Title", "Completar tarea"),
                        subText: t("Dialog_Complete_Subtext", "¿Estás seguro de que quieres completar esta tarea? ¿Ya cargaste todas las horas de la tarea?")
                    }}
                    modalProps={{ isBlocking: updatingId === confirmCompleteId }}
                >
                    <DialogFooter>
                        <PrimaryButton
                            text={t("Btn_Complete", "Completar")}
                            onClick={() => {
                                void handleConfirmComplete();
                            }}
                            disabled={!confirmCompleteId || updatingId === confirmCompleteId}
                        />
                        <DefaultButton
                            text={t("Btn_Cancel", "Cancelar")}
                            onClick={() => {
                                setConfirmCompleteId(null);
                            }}
                            disabled={updatingId === confirmCompleteId}
                        />
                    </DialogFooter>
                </Dialog>

                <div className="tm-version-tag">v0.0.13</div>
            </div>
        </div>
    );
};
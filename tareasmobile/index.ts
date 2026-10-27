import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import { TareasMobileApp, TareasMobileAppProps } from "./components/TareasMobileApp";

export class tareasmobile implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        context.mode.trackContainerResize(true);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const dataset = context.parameters.sampleDataSet;

        const props: TareasMobileAppProps = {
            dataset: dataset,
            webAPI: context.webAPI,
            refreshData: () => {
                if (dataset && typeof dataset.refresh === "function") {
                    dataset.refresh();
                }
            }
        };

        return React.createElement(TareasMobileApp, props);
    }

    public getOutputs(): IOutputs {
        return {};
    }

    public destroy(): void {
        // En controles Virtual, el runtime de Power Apps gestiona el desmontaje del árbol React
    }
}
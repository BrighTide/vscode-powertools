/**
 * This file is part of the vscode-powertools distribution.
 * Copyright (c) Next.e.GO Mobile SE, Aachen, Germany (https://www.e-go-mobile.com/)
 *
 * vscode-powertools is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation, version 3.
 *
 * vscode-powertools is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import * as _ from 'lodash';
import * as ego_apps from '../apps';
import * as ego_contracts from '../contracts';
import * as ego_helpers from '../helpers';
import * as ego_states from '../states';
import * as ego_stores from '../stores';
import * as ego_webview from '../webview';
import * as ego_workspace from '../workspace';
import * as ejs from 'ejs';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';


/**
 * Name of the key for storing app instances.
 */
export const KEY_APPS = 'apps';
let nextAppButtonCommandId = Number.MIN_SAFE_INTEGER;


/**
 * A webview for a custom (workspace) app.
 */
export class WorkspaceAppWebView extends ego_apps.AppWebViewBase {
    /**
     * Initializes a new instance of that class.
     *
     * @param {ego_workspace.Workspace} workspace The underlying workspace.
     * @param {ego_contracts.AppItem} item The item from the settings.
     * @param {vscode.StatusBarItem} [button] The underlying button.
     */
    public constructor(
        public readonly workspace: ego_workspace.Workspace,
        public readonly item: ego_contracts.AppItem,
        public readonly button?: vscode.StatusBarItem,
    ) {
        super(workspace.context.extension);

        const SCRIPT_PATH = workspace.replaceValues(
            item.script
        );

        const FULL_SCRIPT_PATH = workspace.getExistingFullPath(
            SCRIPT_PATH
        );

        if (false === FULL_SCRIPT_PATH) {
            throw new Error(`Script '${SCRIPT_PATH}' not found!`);
        }

        this.module = ego_helpers.loadScriptModule<ego_contracts.AppModule>(
            FULL_SCRIPT_PATH
        );
        this.scriptFile = FULL_SCRIPT_PATH;
    }

    /**
     * @inheritdoc
     */
    protected createScriptArguments(
        eventName: string,
        data?: any,
    ): ego_contracts.WorkspaceAppEventScriptArguments {
        const ME = this;

        const ARGS: ego_contracts.WorkspaceAppEventScriptArguments = {
            button: this.button,
            clearTemp: () => {
                return this.clearTempDir();
            },
            data: data,
            event: eventName,
            exists: (p) => {
                return this.fileSystemItemExists(p);
            },
            extension: this.extension,
            getAllWorkspaces: () => {
                return this.getAllWorkspaces();
            },
            getFileResourceUri: (p, asString?) => {
                let uri: string | vscode.Uri = this.getFileResourceUri(p);
                if (!_.isNil(uri)) {
                    if (ego_helpers.toBooleanSafe(asString, true)) {
                        uri = `${uri}`;
                    }
                }

                return uri;
            },
            globals: ego_helpers.cloneObject(this.workspace.settings.globals),
            globalState: ego_states.GLOBAL_STATE,
            globalStore: new ego_stores.UserStore(),
            logger: this.workspace.logger,
            options: ego_helpers.cloneObject(this.item.options),
            output: this.workspace.output,
            post: (cmd, data?) => {
                return this.postMessage(
                    cmd, data
                );
            },
            readFile: (p) => {
                return this.readFile(p);
            },
            remove: (p) => {
                this.removeFileOrFolder(p);
            },
            render: function (source, data?) {
                return ejs.render(
                    ego_helpers.toStringSafe(source),
                    data
                );
            },
            renderFile: function (file, data?) {
                file = ego_helpers.toStringSafe(
                    file
                );

                if (!path.isAbsolute(file)) {
                    file = path.join(
                        path.dirname(ME.scriptFile),
                        file
                    );
                }

                return this.render(
                    fsExtra.readFileSync(
                        path.resolve(file),
                        'utf8'
                    ),
                    data
                );
            },
            readTextFile: function (p, e?) {
                e = ego_helpers.normalizeString(e);
                if ('' === e) {
                    e = 'utf8';
                }

                return this.readFile(p)
                    .toString(e);
            },
            replaceValues: (val) => {
                return this.workspace
                    .replaceValues(val);
            },
            require: (id) => {
                return ego_helpers.requireModule(id);
            },
            stat: (p, lstat) => {
                return this.fileSystemItemStat(p, lstat);
            },
            state: undefined,
            store: new ego_stores.UserStore(this.scriptFile),
            tempFile: () => {
                return this.createTempFile();
            },
            toDataPath: (p) => {
                return this.toFullDataPath(p);
            },
            workspaces: undefined,
            writeFile: (p, data) => {
                this.writeFile(p, data);
            },
        };

        // ARGS.state
        const STATE_GETTER_SETTER = ego_states.getScriptState(
            this.scriptFile, this.workspace.scriptStates,
            ego_helpers.getInitialStateValue(
                this.item
            )
        );
        Object.defineProperty(ARGS, 'state', {
            enumerable: true,
            get: STATE_GETTER_SETTER.get,
            set: STATE_GETTER_SETTER.set,
        });

        // ARGS.workspaces
        Object.defineProperty(ARGS, 'workspaces', {
            enumerable: true,
            get: () => {
                return ego_workspace.getWorkspaceList();
            }
        });

        return ARGS;
    }

    /**
     * Creates a new instance from an app item.
     *
     * @param {ego_workspace.Workspace} workspace The underlying workspace.
     * @param {ego_contracts.AppItem} item The item from the settings.
     * @param {vscode.StatusBarItem} [button] The underlying button.
     *
     * @return {WorkspaceAppWebView} The new instance.
     */
    public static fromItem(
        item: ego_contracts.AppItem,
        workspace: ego_workspace.Workspace,
        button?: vscode.StatusBarItem,
    ): WorkspaceAppWebView {
        if (ego_helpers.toBooleanSafe(item.vue)) {
            return new WorkspaceAppWebViewWithVue(
                workspace,
                item,
                button,
            );
        }

        return new WorkspaceAppWebView(
            workspace,
            item,
            button,
        );
    }

    /**
     * @inheritdoc
     */
    protected getResourceUris() {
        const URIs: vscode.Uri[] = super.getResourceUris();

        // '.vscode' sub folder inside workspace
        URIs.splice(
            1, 0,
            vscode.Uri.file(path.resolve(
                path.join(this.workspace.rootPath, '.vscode')
            ))
        );

        return URIs;
    }

    /**
     * @inheritdoc
     */
    public readonly module: ego_contracts.AppModule;

    /**
     * @inheritdoc
     */
    public readonly scriptFile: string;
}

/**
 * A webview for a custom (workspace) app based on Vuetify.
 */
export class WorkspaceAppWebViewWithVue extends WorkspaceAppWebView {
    /**
     * @inheritdoc
     */
    protected generateHtml(): string {
        const PARTS = ego_webview.getVueParts(
            this.generateHtmlBody()
        );

        const HEADER = this.generateHtmlHeader();
        const FOOTER = this.generateHtmlFooter();

        return `${HEADER}

${PARTS.template}

${FOOTER}
`;
    }

    /**
     * @inheritdoc
     */
    protected generateHtmlBody(): string {
        const ARGS = this.createScriptArguments('get.html');

        let vue: string;

        const FUNC = this.getEventFunction(m => m.getHtml);
        if (FUNC) {
            vue = FUNC(ARGS);
        }

        return ego_helpers.toStringSafe(
            vue
        );
    }

    /**
     * @inheritdoc
     */
    protected generateHtmlFooter(): string {
        const PARTS = ego_webview.getVueParts(
            this.generateHtmlBody()
        );

        return ego_webview.getVueFooter({
            extra: `
<style>

${PARTS.style}

</style>

<script>

${PARTS.script}

</script>
`,
            scripts: {
                app: `${this.getFileResourceUri('js/app.vuetify.js')}`,
                deepmerge: `${this.getFileResourceUri('js/deepmerge.js')}`,
                vue: `${this.getFileResourceUri('js/vue.js')}`,
                vuetify: `${this.getFileResourceUri('js/vuetify.js')}`,
            },
        });
    }

    /**
     * @inheritdoc
     */
    protected generateHtmlHeader(): string {
        return ego_webview.getVueHeader({
            fonts: {
                fa5: `${this.getFileResourceUri('css/font-awesome-5.css')}`,
                materialIcons: `${this.getFileResourceUri('css/materialdesignicons.css')}`,
                roboto: `${this.getFileResourceUri('css/roboto.css')}`,
            },
            images: {
                logo: `${this.getFileResourceUri('img/ego.png')}`,
            },
            styles: {
                app: `${this.getFileResourceUri('css/app.vuetify.css')}`,
                vuetify: `${this.getFileResourceUri('css/vuetify.css')}`,
            },
            title: this.getTitle(),
        });
    }
}


/**
 * Disposes all workspace apps.
 */
export async function disposeApps() {
    const WORKSPACE: ego_workspace.Workspace = this;

    const COMMAND_LIST: ego_contracts.WorkspaceApp[] = WORKSPACE.instanceState[
        KEY_APPS
    ];
    while (COMMAND_LIST.length > 0) {
        const CMD = COMMAND_LIST.pop();

        ego_helpers.tryDispose(CMD);
    }
}

/**
 * Reloads all workspace apps.
 */
export async function reloadApps() {
    const WORKSPACE: ego_workspace.Workspace = this;
    if (WORKSPACE.isInFinalizeState) {
        return;
    }
    if (!WORKSPACE.isInitialized) {
        return;
    }

    const SETTINGS = WORKSPACE.settings;
    if (!SETTINGS) {
        return;
    }

    disposeApps.apply(
        this
    );

    const APP_ENTRIES = ego_helpers.asArray(
        SETTINGS.apps
    );
    if (APP_ENTRIES.length < 1) {
        return;
    }

    const APP_LIST: ego_contracts.WorkspaceApp[] = WORKSPACE.instanceState[
        KEY_APPS
    ];

    APP_ENTRIES.forEach(entry => {
        let newAppBtn: vscode.StatusBarItem;
        let newAppBtnCommand: vscode.Disposable;
        const DISPOSE_BTN = () => {
            ego_helpers.tryDispose(newAppBtn);
            ego_helpers.tryDispose(newAppBtnCommand);
        };

        try {
            let item: ego_contracts.AppItem;
            if (_.isObjectLike(entry)) {
                item = <ego_contracts.AppItem>entry;
            } else {
                item = {
                    script: ego_helpers.toStringSafe(entry),
                };
            }
            item = WORKSPACE.importValues(item);

            if (!WORKSPACE.doesMatchPlatformCondition(item)) {
                return;
            }
            if (!WORKSPACE.doesMatchFilterCondition(item)) {
                return;
            }

            let name = ego_helpers.toStringSafe(
                item.name
            ).trim();
            if ('' === name) {
                name = item.script;
            }

            let description = ego_helpers.toStringSafe(
                item.description
            ).trim();
            if ('' === description) {
                description = undefined;
            }

            let view: WorkspaceAppWebView;
            let newApp: ego_contracts.WorkspaceApp = {
                description: undefined,
                detail: undefined,
                dispose: function () {
                    DISPOSE_BTN();

                    const VIEW = view;
                    if (VIEW) {
                        VIEW.dispose();
                    }

                    view = null;

                    if (!_.isNil(item.onDestroyed)) {
                        WORKSPACE.executeCode(
                            item.onDestroyed
                        );
                    }
                },
                name: undefined,
                open: async function () {
                    if (view) {
                        return false;
                    }

                    const NEW_VIEW = WorkspaceAppWebView.fromItem(
                        item, WORKSPACE
                    );

                    if (!(await NEW_VIEW.open())) {
                        return false;
                    }

                    return NEW_VIEW;
                },
                view: undefined,
            };

            // newApp.button
            Object.defineProperty(newApp, 'button', {
                enumerable: true,
                get: () => {
                    return newAppBtn;
                },
            });

            // newApp.description
            Object.defineProperty(newApp, 'description', {
                enumerable: true,
                get: () => {
                    const DESCRIPTION = WORKSPACE.replaceValues(
                        description
                    ).trim();

                    return '' !== DESCRIPTION ? DESCRIPTION
                        : undefined;
                }
            });

            // newApp.detail
            Object.defineProperty(newApp, 'detail', {
                enumerable: true,
                get: () => {
                    let detail = WORKSPACE.getExistingFullPath(
                        item.script
                    );
                    if (false === detail) {
                        detail = ego_helpers.toStringSafe(
                            item.script
                        );
                    }

                    return detail;
                }
            });

            // newApp.name
            Object.defineProperty(newApp, 'name', {
                enumerable: true,
                get: () => {
                    const NAME = WORKSPACE.replaceValues(
                        name
                    ).trim();

                    return '' !== NAME ? NAME
                        : undefined;
                }
            });

            // newApp.view
            Object.defineProperty(newApp, 'view', {
                enumerable: true,
                get: () => {
                    return view;
                }
            });

            if (item.button) {
                const ID = nextAppButtonCommandId++;
                const CMD_ID = `ego.power-tools.buttons.appBtn${ID}`;

                newAppBtnCommand = vscode.commands.registerCommand(CMD_ID, async () => {
                    try {
                        await newApp.open();
                    } catch (e) {
                        ego_helpers.showErrorMessage(e);
                    }
                });

                newAppBtn = ego_helpers.buildButtonSync(item.button, (btn) => {
                    btn.text = WORKSPACE.replaceValues(btn.text);
                    if (ego_helpers.isEmptyString(btn.text)) {
                        btn.text = newApp.name;
                    }

                    btn.color = WORKSPACE.replaceValues(btn.color);
                    btn.tooltip = WORKSPACE.replaceValues(btn.tooltip);
                    btn.command = CMD_ID;
                });
            }

            if (newApp) {
                if (newApp.button) {
                    newApp.button.show();
                }

                APP_LIST.push(
                    newApp
                );

                if (!_.isNil(item.onCreated)) {
                    WORKSPACE.executeCode(
                        item.onCreated
                    );
                }
            } else {
                DISPOSE_BTN();
            }
        } catch (e) {
            WORKSPACE.logger
                .trace(e, 'apps.reloadApps(1)');

            DISPOSE_BTN();
        }
    });
}

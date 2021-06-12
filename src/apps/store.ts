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
import * as ego_log from '../log';
import * as ego_webview from '../webview';
import * as ejs from 'ejs';
import * as fsExtra from 'fs-extra';
import * as moment from 'moment';
import * as path from 'path';
import * as vscode from 'vscode';


interface App {
    name: string;
    displayName: string;
    description?: string;
    details?: string;
    icon?: string;
    isInstalled: boolean;
    source: string;
    upgradeSource?: string;
}

interface KnownAppList {
    apps: string[];
    lastCheck: string;
    store: string;
}

interface UninstallAppData {
    name: string;
    source: string;
}


 /**
  * A web view for an app store.
  */
export class AppStoreWebView extends ego_webview.WebViewWithContextBase {
    private _onAppListUpdatedEventFunction: (...args: any[]) => void;

    /**
     * Initializes a new instance of that class.
     *
     * @param {vscode.ExtensionContext} extension The extension context.
     * @param {vscode.OutputChannel} output The output channel.
     */
    public constructor(
        public readonly extension: vscode.ExtensionContext,
        public readonly output: vscode.OutputChannel,
    ) {
        super(extension);
    }

    /**
     * @inheritdoc
     */
    protected generateHtmlBody(): string {
        const FILE = this.getFileResourceUri('tpl/AppStore.ejs')
            .fsPath;

        return ejs.render(
            fsExtra.readFileSync(
                FILE, 'utf8'
            )
        );
    }

    /**
     * @inheritdoc
     */
    protected getTitle(): string {
        return `App Store for 'vscode-powertools'`;
    }

    /**
     * @inheritdoc
     */
    protected getType(): string {
        return `AppStore`;
    }

    private async loadStoreFromUrl(appStoreUrl?: string): Promise<ego_contracts.AppStore> {
        try {
            if (arguments.length < 1) {
                appStoreUrl = getAppStoreUrl(this.extension);
            }

           return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
            }, async (progress) => {
                progress.report({
                    message: `Loading app list from '${ appStoreUrl }' ...`,
                });

                return await loadStoreFrom(
                    appStoreUrl, arguments.length < 1
                );
            });
        } catch (e) {
            if (arguments.length < 1) {
                throw e;
            } else {
                ego_log.CONSOLE.trace(
                    e, `apps.AppStoreWebView.loadStoreFromUrl(${ appStoreUrl })`
                );
            }
        }
    }

    private onAppListUpdated() {
        this.postMessage(
            'appListUpdated'
        );
    }

    /**
     * @inheritdoc
     */
    protected onDispose() {
        this.unsetOnAppListUpdatedEventFunction();

        super.onDispose();
    }

    /**
     * @inheritdoc
     */
    protected async onWebViewMessage(msg: ego_contracts.WebViewMessage): Promise<boolean> {
        switch (msg.command) {
            case 'installApp':
            case 'upgradeApp':
                {
                    let err: any;
                    try {
                        const APP_URL = ego_helpers.toStringSafe(msg.data.source)
                            .trim();
                        if (APP_URL.toLowerCase().startsWith('https://') || APP_URL.toLowerCase().startsWith('http://')) {
                            let app: Buffer;
                            await vscode.window.withProgress({
                                location: vscode.ProgressLocation.Notification,
                            }, async (progress) => {
                                progress.report({
                                    message: `Download app from '${ APP_URL }' ...`,
                                });

                                const RESPONSE = await ego_helpers.GET(APP_URL);
                                if (RESPONSE.code < 200 || RESPONSE.code >= 300) {
                                    throw new Error(`Unexpected response: [${ RESPONSE.code }] '${ RESPONSE.status }'`);
                                }

                                app = await RESPONSE.readBody();
                            });

                            await ego_apps.installAppFromFile(
                                app
                            );
                        }
                    } catch (e) {
                        err = ego_helpers.errorToString(e);
                    }

                    await this.postMessage('appInstalled', {
                        success: _.isNil(err),
                        app: msg.data,
                        error: err,
                    });
                }
                break;

            case 'openApp':
                {
                    let err: any;
                    try {
                        const INSTALLED_APPS = await ego_apps.getInstalledApps();

                        const NAME = ego_helpers.normalizeString(msg.data.name);
                        if ('' !== NAME) {
                            const APPS_TO_OPEN = INSTALLED_APPS.filter(
                                a => NAME === ego_helpers.normalizeString(
                                    path.basename(a.path)
                                )
                            );

                            for (const A of APPS_TO_OPEN) {
                                await ego_apps.openAppByName(
                                    this.extension,
                                    this.output,
                                    path.basename(A.path)
                                );
                            }
                        }
                    } catch (e) {
                        e = err;
                    }
                }
                break;

            case 'reloadApps':
                try {
                    const APPS: App[] = [];
                    let storeName: string;

                    // installed apps
                    const INSTALLED_APPS = await ego_apps.getInstalledApps();
                    for (const IA of INSTALLED_APPS) {
                        try {
                            let name: string;
                            let displayName: string;
                            let description: string;
                            let details: string;
                            let icon: string;

                            try {
                                const PACKAGE_JSON = await IA.loadPackageJSON();
                                if (PACKAGE_JSON) {
                                    name = PACKAGE_JSON.name;
                                    description = PACKAGE_JSON.description;
                                    displayName = PACKAGE_JSON.displayName;
                                }
                            } catch { }

                            try {
                                const README = await IA.loadREADME();
                                if (false !== README) {
                                    details = README;
                                }
                            } catch { }

                            try {
                                const ICON = await IA.loadIcon();
                                if (false !== ICON) {
                                    icon = ICON;
                                }
                            } catch { }

                            if (ego_helpers.isEmptyString(name)) {
                                name = path.basename(
                                    path.dirname(IA.path)
                                );
                            }

                            if (ego_helpers.isEmptyString(displayName)) {
                                displayName = name;
                            }

                            if (ego_helpers.isEmptyString(description)) {
                                description = undefined;
                            }

                            if (ego_helpers.isEmptyString(details)) {
                                details = undefined;
                            }

                            if (ego_helpers.isEmptyString(icon)) {
                                icon = undefined;
                            }

                            APPS.push({
                                'name': name,
                                'displayName': displayName,
                                'description': description,
                                'details': details,
                                'icon': icon,
                                'isInstalled': true,
                                'source': path.basename(IA.path),
                            });
                        } catch { }
                    }

                    // store apps
                    try {
                        const APP_STORE = await this.loadStoreFromUrl();
                        if (_.isObjectLike(APP_STORE)) {
                            storeName = ego_helpers.toStringSafe(
                                APP_STORE.name
                            ).trim();

                            for (const A of APP_STORE.apps) {
                                try {
                                    let name = ego_helpers.normalizeString(A.name);
                                    if ('' === name) {
                                        continue;
                                    }

                                    let source = ego_helpers.toStringSafe(A.source)
                                        .trim();
                                    if ('' === source) {
                                        continue;
                                    }

                                    if (!source.toLowerCase().startsWith('https://') && !source.toLowerCase().startsWith('http://')) {
                                        source = 'http://' + source;
                                    }

                                    let displayName = ego_helpers.toStringSafe(
                                        A.displayName
                                    ).trim();
                                    if ('' === displayName) {
                                        displayName = name;
                                    }

                                    let description = ego_helpers.toStringSafe(
                                        A.description
                                    ).trim();
                                    if ('' === description) {
                                        description = undefined;
                                    }

                                    let icon = ego_helpers.toStringSafe(
                                        A.icon
                                    ).trim();
                                    if ('' === icon) {
                                        icon = undefined;
                                    }

                                    APPS.push({
                                        'name': name,
                                        'displayName': displayName,
                                        'description': description,
                                        'details': undefined,
                                        'icon': icon,
                                        'isInstalled': false,
                                        'source': source,
                                    });
                                } catch { }
                            }
                        }
                    } catch { }

                    await this.postMessage(
                        'appsLoaded',
                        {
                            'success': true,
                            'apps': ego_helpers.from(APPS)
                                .groupBy(a => ego_helpers.normalizeString(a.name))
                                .select(grp => {
                                    const APPS_OF_GROUP = grp.toArray();

                                    return {
                                        apps: APPS_OF_GROUP,
                                    };
                                })
                                .where(x => x.apps.length > 0)
                                .pipe(x => {
                                    const STORE_APPS = x.apps
                                        .filter(a => !a.isInstalled && !ego_helpers.isEmptyString(a.source));

                                    x.apps[0].upgradeSource =
                                        STORE_APPS.length > 1 ? STORE_APPS[0].source : undefined;
                                })
                                .select(x => {
                                    return x.apps[0];
                                })
                                .orderBy(x => x.isInstalled ? 0 : 1)
                                .thenBy(x => ego_helpers.normalizeString(x.displayName))
                                .thenBy(x => ego_helpers.normalizeString(x.name))
                                .thenBy(x => ego_helpers.normalizeString(x.source))
                                .thenBy(x => ego_helpers.normalizeString(x.upgradeSource))
                                .toArray(),
                            'store': storeName,
                        }
                    );
                } catch (e) {
                    await this.postMessage(
                        'appsLoaded',
                        {
                            'success': false,
                            'error': ego_helpers.errorToString(e),
                        }
                    );
                }
                break;

            case 'uninstallApp':
                {
                    const APP_TO_UNINSTALL: UninstallAppData = msg.data;
                    if (_.isObjectLike(APP_TO_UNINSTALL)) {
                        if (!ego_helpers.isEmptyString(APP_TO_UNINSTALL.source)) {
                            const DIRS_WITH_APPS = ego_helpers.getAppsDir();

                            const APP_DIR = path.resolve(
                                path.join(
                                    DIRS_WITH_APPS,
                                    ego_helpers.toStringSafe(APP_TO_UNINSTALL.source),
                                )
                            );

                            if (await ego_helpers.isDirectory(APP_DIR)) {
                                if (APP_DIR.startsWith(DIRS_WITH_APPS + path.sep)) {
                                    let err: any;
                                    try {
                                        await fsExtra.remove(
                                            APP_DIR
                                        );

                                        vscode.window.showInformationMessage(
                                            `App '${ ego_helpers.toStringSafe(APP_TO_UNINSTALL.name) }' has been uninstalled.`
                                        );
                                    } catch (e) {
                                        err = e;

                                        vscode.window.showErrorMessage(
                                            `Could not uninstall app '${ ego_helpers.toStringSafe(APP_TO_UNINSTALL.name) }': '${ ego_helpers.toStringSafe(e) }'`
                                        );
                                    }

                                    await this.postMessage(
                                        'appUninstalled',
                                        {
                                            'success': _.isNil(err),
                                            'app': APP_TO_UNINSTALL,
                                        }
                                    );
                                }
                            } else {
                                vscode.window.showWarningMessage(
                                    `Directory for app '${ ego_helpers.toStringSafe(APP_TO_UNINSTALL.name) }' not found!`
                                );
                            }
                        }
                    }
                }
                break;

            default:
                return false;
        }

        return true;
    }

    /**
     * @inheritdoc
     */
    public async open() {
        this.unsetOnAppListUpdatedEventFunction();

        this._onAppListUpdatedEventFunction = () => {
            this.onAppListUpdated();
        };

        ego_helpers.EVENTS
                   .on(ego_contracts.EVENT_APP_LIST_UPDATED,
                       this._onAppListUpdatedEventFunction);

        return await super.open();
    }

    private unsetOnAppListUpdatedEventFunction() {
        ego_helpers.tryRemoveListener(
            ego_helpers.EVENTS,
            ego_contracts.EVENT_APP_LIST_UPDATED,
            this._onAppListUpdatedEventFunction
        );

        this._onAppListUpdatedEventFunction = null;
    }
}


/**
 * Checks for new apps in store.
 *
 * @param {vscode.ExtensionContext} extension The underlying extension context.
 *
 * @return {string[]} The list of new apps.
 */
export async function checkForNewApps(
    extension: vscode.ExtensionContext,
): Promise<string[]> {
    const TODAY = ego_helpers.utcNow()
        .startOf('day');

    const NEW_APPS: string[] = [];

    await vscode.window.withProgress({
        cancellable: false,
        location: vscode.ProgressLocation.Window,
    }, async (progress) => {
        progress.report({
            message: `Checking for new apps ...`,
        });

        const APP_STORE_URL = getAppStoreUrl(extension);

        const LOAD_APPS = async () => {
            let apps: ego_contracts.AppStoreApp[];

            const APP_STORE = await loadStoreFrom(APP_STORE_URL, true);
            if (APP_STORE) {
                apps = APP_STORE.apps;
            }

            return ego_helpers.from(
                ego_helpers.asArray(
                    apps
                )
            ).select(a => ego_helpers.normalizeString(a.name))
             .where(a => '' !== a)
             .distinct()
             .order()
             .toArray();
        };

        let knownApps: KnownAppList = extension.globalState
            .get<KnownAppList>(ego_contracts.KEY_KNOWN_APPS, null);

        let update = false;
        const ASYNC_REFRESH_ENTRY = async () => {
            knownApps = {
                apps: await LOAD_APPS(),
                lastCheck: TODAY.toISOString(),
                store: APP_STORE_URL,
            };

            update = true;
        };

        if (knownApps) {
            if (APP_STORE_URL === knownApps.store) {
                const LAST_CHECK = moment.utc(knownApps.lastCheck);
                if (TODAY.diff(LAST_CHECK, 'days') >= 3) {
                    const CURRENT_APPS = await LOAD_APPS();

                    for (const CA of CURRENT_APPS) {
                        if (knownApps.apps.indexOf(CA) < 0) {
                            NEW_APPS.push(CA);
                        }
                    }

                    knownApps = {
                        apps: CURRENT_APPS,
                        lastCheck: TODAY.toISOString(),
                        store: APP_STORE_URL,
                    };

                    update = true;
                }
            } else {
                // new app store
                await ASYNC_REFRESH_ENTRY();
            }
        } else {
            // not loaded yet
            await ASYNC_REFRESH_ENTRY();
        }

        if (update) {
            await extension.globalState
                .update(ego_contracts.KEY_KNOWN_APPS, knownApps);
        }
    });

    return NEW_APPS;
}

function getAppStoreUrl(
    extension: vscode.ExtensionContext,
): string {
    let appStoreUrl = ego_helpers.toStringSafe(
        extension.globalState
            .get(ego_contracts.KEY_GLOBAL_SETTING_APP_STORE_URL)
    );

    appStoreUrl = ego_helpers.toStringSafe(
        appStoreUrl
    ).trim();
    if ('' === appStoreUrl) {
        appStoreUrl = ego_contracts.EGO_APP_STORE;
    }

    if (!appStoreUrl.toLowerCase().startsWith('https://') && !appStoreUrl.toLowerCase().startsWith('http://')) {
        appStoreUrl = 'http://' + appStoreUrl;
    }

    return appStoreUrl.trim();
}

async function loadStoreFrom(url: string, loadImports: boolean): Promise<ego_contracts.AppStore> {
    const RESPONSE = await ego_helpers.GET(url, null, {
        timeout: 5000,
    });
    if (RESPONSE.code < 200 || RESPONSE.code >= 300) {
        throw new Error(`Unexpected response: [${ RESPONSE.code }] '${ RESPONSE.status }'`);
    }

    const APP_STORE: ego_contracts.AppStore = JSON.parse(
        (await RESPONSE.readBody()).toString('utf8')
    );

    if (APP_STORE) {
        APP_STORE.apps = ego_helpers.asArray(
            APP_STORE.apps
        );

        for (const A of APP_STORE.apps) {
            A.__source = {
                app: A,
                store: APP_STORE,
                url: url,
            };
        }

        // imports
        if (loadImports) {
            const IMPORTS = ego_helpers.from(
                ego_helpers.asArray(APP_STORE.imports)
            ).select(x => ego_helpers.toStringSafe(x).trim())
             .where(x => '' !== x)
             .distinct()
             .take(5)
             .toArray();

            for (const I of IMPORTS) {
                const SUB_STORE = await loadStoreFrom(I, false);
                if (SUB_STORE) {
                    ego_helpers.from(
                        ego_helpers.asArray(SUB_STORE.apps)
                    ).pushTo( APP_STORE.apps );
                }
            }
        }
    }

    return APP_STORE;
}

/**
 * Opens the app store.
 *
 * @param {vscode.ExtensionContext} extension The extension context.
 * @param {vscode.OutputChannel} output The output channel.
 *
 * @return {Promise<AppStoreWebView>} The promise with the new web view.
 */
export async function openAppStore(
    extension: vscode.ExtensionContext,
    output: vscode.OutputChannel,
): Promise<AppStoreWebView> {
    const APP_STORE = new AppStoreWebView(extension, output);
    await APP_STORE.open();

    return APP_STORE;
}

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
import * as ego_contracts from '../contracts';
import * as ego_global_values from '../global/values';
import * as ego_helpers from '../helpers';
import * as ego_log from '../log';
import * as ego_pt from '../extension';
import * as vscode from 'vscode';


const GLOBAL_COMMANDS: ego_contracts.GlobalCommand[] = [];


/**
 * Disposes all global commands.
 */
export function disposeGlobalUserCommands() {
    while (GLOBAL_COMMANDS.length > 0) {
        ego_helpers.tryDispose(
            GLOBAL_COMMANDS.pop()
        );
    }
}

/**
 * Returns the list of all global commands.
 *
 * @return {ego_contracts.GlobalCommand[]} The list of commands.
 */
export function getGlobalUserCommands(): ego_contracts.GlobalCommand[] {
    return ego_helpers.asArray(
        GLOBAL_COMMANDS
    );
}

/**
 * Inits events for global commands.
 *
 * @param {vscode.ExtensionContext} extension The extension context.
 */
export function initGlobalCommandEvents(extension: vscode.ExtensionContext) {
    extension.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            try {
                const LIST_OF_COMMANDS = GLOBAL_COMMANDS.map(cmd => {
                    const ITEM: ego_contracts.CommandItem = cmd['__item'];

                    return {
                        command: cmd,
                        item: ITEM,
                    };
                });

                // update button visibility
                LIST_OF_COMMANDS.forEach(x => {
                    try {
                        if (x.command.button) {
                            let isVisible = true;

                            if (x.item.button) {
                                isVisible = ego_helpers.isVisibleForActiveEditor(x.item.button);
                            }

                            if (isVisible) {
                                x.command.button.show();
                            } else {
                                x.command.button.hide();
                            }
                        }
                    } catch (e) {
                        ego_log.CONSOLE
                            .trace(e, 'global.commands.initGlobalCommandEvents.onDidChangeActiveTextEditor(2)');
                    }
                });

                // onEditorChanged events
                ego_helpers.executeOnEditorChangedEvents(
                    LIST_OF_COMMANDS.filter(x => {
                        return !!x.item.button &&
                            !!x.command.button;
                    }).map(x => {
                        const CMD_ID: string = x.command['__id'];

                        return {
                            button: x.command.button,
                            command: CMD_ID,
                            item: x.item,
                            onEditorChanged: x.item.button.onEditorChanged,
                        };
                    }),
                    (code: string, x) => {
                        return ego_pt.executeCode(code, [{
                            name: 'button',
                            value: ego_helpers.toCodeButton(
                                <any>{
                                    '__command': x.command,
                                    '__item': x.item.button,
                                    '__status_item': x.button,
                                },
                            ),
                        }]);
                    }
                );
            } catch (e) {
                ego_log.CONSOLE
                    .trace(e, 'global.commands.initGlobalCommandEvents.onDidChangeActiveTextEditor(1)');
            }
        }),
    );
}

/**
 * Reloads all global commands.
 */
export async function reloadGlobalUserCommands() {
    const SETTINGS: ego_contracts.GlobalExtensionSettings = this;

    disposeGlobalUserCommands.apply(
        this
    );

    const COMMAND_LIST: ego_contracts.GlobalCommand[] = GLOBAL_COMMANDS;

    if (SETTINGS.commands) {
        _.forIn(SETTINGS.commands, (entry, key) => {
            let item: ego_contracts.CommandItem = ego_pt.importValues(
                entry
            );
            const ID = ego_helpers.toStringSafe(key)
                .trim();

            if (!item) {
                return;
            }

            if (!ego_helpers.doesMatchPlatformCondition(item)) {
                return;
            }
            if (!ego_helpers.doesMatchFilterCondition(item)) {
                return;
            }

            let name = ego_helpers.toStringSafe(
                item.name
            ).trim();
            if ('' === name) {
                name = key;
            }

            let description = ego_helpers.toStringSafe(
                item.description
            ).trim();
            if ('' === description) {
                description = undefined;
            }

            let newButton: vscode.StatusBarItem;
            let newCommand: vscode.Disposable;
            try {
                newCommand = vscode.commands.registerCommand(ID, function(context: ego_contracts.CommandExecutionContext) {
                    const ARGS = ego_helpers.from(
                        ego_helpers.toArray(arguments)
                    ).skip(1)
                     .toArray();

                    return ego_pt.executeScript<ego_contracts.GlobalCommandScriptArguments>(
                        item,
                        (args) => {
                            // args.arguments
                            Object.defineProperty(args, 'arguments', {
                                enumerable: true,
                                get: () => {
                                    return ARGS;
                                },
                            });

                            // args.command
                            Object.defineProperty(args, 'command', {
                                enumerable: true,
                                get: () => {
                                    return key;
                                },
                            });

                            ego_helpers.updateCommandScriptArgumentsByExecutionContext(
                                args, context
                            );

                            return args;
                        }
                    );
                });

                const NEW_GLOBAL_CMD: ego_contracts.GlobalCommand = <any>{
                    '__id': ID,
                    '__item': item,
                    button: undefined,
                    command: newCommand,
                    description: undefined,
                    dispose: function() {
                        ego_helpers.tryDispose(this.button);
                        ego_helpers.tryDispose(this.command);

                        if (!_.isNil(item.onDestroyed)) {
                            ego_pt.executeCode(
                                item.onDestroyed
                            );
                        }
                    },
                    execute: function () {
                        return vscode.commands.executeCommand
                            .apply(null, [ ID ].concat( ego_helpers.toArray(arguments) ));
                    },
                    id: ID,
                    item: item,
                    name: undefined,
                };

                // NEW_GLOBAL_CMD.button
                Object.defineProperty(NEW_GLOBAL_CMD, 'button', {
                    enumerable: true,
                    get: () => {
                        return newButton;
                    }
                });

                // NEW_GLOBAL_CMD.description
                Object.defineProperty(NEW_GLOBAL_CMD, 'description', {
                    enumerable: true,
                    get: () => {
                        const DESCRIPTION = ego_global_values.replaceValues(
                            description
                        ).trim();

                        return '' !== DESCRIPTION ? DESCRIPTION
                                                  : undefined;
                    }
                });

                // NEW_GLOBAL_CMD.name
                Object.defineProperty(NEW_GLOBAL_CMD, 'name', {
                    enumerable: true,
                    get: () => {
                        const NAME = ego_global_values.replaceValues(
                            name
                        ).trim();

                        return '' !== NAME ? NAME
                                           : undefined;
                    }
                });

                if (item.button) {
                    newButton = ego_helpers.buildButtonSync(
                        item.button,
                        (newBtn) => {
                            if (_.isNil(newBtn.text)) {
                                newBtn.text = name;
                            }

                            if (_.isNil(newBtn.tooltip)) {
                                newBtn.tooltip = key;
                            }

                            newBtn.text = ego_global_values.replaceValues(newBtn.text);
                            newBtn.tooltip = ego_global_values.replaceValues(newBtn.tooltip);
                            newBtn.color = ego_global_values.replaceValues(newBtn.color);
                            newBtn.command = ID;
                        }
                    );
                }

                COMMAND_LIST.push(
                    NEW_GLOBAL_CMD
                );

                if (!_.isNil(item.onCreated)) {
                    ego_pt.executeCode(
                        item.onCreated
                    );
                }

                if (newButton) {
                    if (ego_helpers.isVisibleForActiveEditor(item.button)) {
                        newButton.show();
                    } else {
                        newButton.hide();
                    }
                }
            } catch (e) {
                ego_helpers.tryDispose(newButton);
                ego_helpers.tryDispose(newCommand);

                ego_log.CONSOLE
                    .trace(e, `global.commands.reloadCommands(${ key })`);
            }
        });
    }
}

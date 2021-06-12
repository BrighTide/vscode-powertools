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
import * as ego_contracts from './contracts';
import * as ego_helpers from './helpers';


/**
 * The global, extension-wide state object, which can store values as key/value pairs.
 */
export const GLOBAL_STATE: ego_contracts.KeyValuePairs = {};
const SCRIPT_STATES: ego_contracts.FileStateStorage = {};


/**
 * Returns the getter and setter for the state of a script.
 *
 * @param {string} script The path of the script.
 * @param {ego_contracts.FileStateStorage} [storage] The custom storage.
 * @param {any} [initialValue] The custom, initial value.
 *
 * @return {ego_contracts.GetterAndSetter} The getter and setter.
 */
export function getScriptState(
    script: string, storage?: ego_contracts.FileStateStorage,
    initialValue: any = {},
): ego_contracts.GetterAndSetter {
    script = ego_helpers.toStringSafe(script);
    if (_.isNil(storage)) {
        storage = SCRIPT_STATES;
    }

    let getterSetter = storage[script];
    if (_.isNil(getterSetter)) {
        let state: any = initialValue;
        storage[script] = getterSetter = {
            get: () => {
                return state;
            },
            set: (newValue: any) => {
                state = newValue;
            }
        };
    }

    return getterSetter;
}

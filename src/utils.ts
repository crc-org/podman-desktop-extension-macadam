/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import * as extensionApi from '@podman-desktop/api';

const macosExtraPath = '/opt/podman/bin:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin';
const localBinDir = '/usr/local/bin';

/**
 * Calculate the system path of the binary
 * @returns
 */
export function getSystemBinaryPath(binaryName: string): string {
  switch (process.platform) {
    case 'win32':
      return join(
        homedir(),
        'AppData',
        'Local',
        'Microsoft',
        'WindowsApps',
        binaryName.endsWith('.exe') ? binaryName : `${binaryName}.exe`,
      );
    case 'darwin':
    case 'linux':
      return join(localBinDir, binaryName);
    default:
      throw new Error(`unsupported platform: ${process.platform}.`);
  }
}

/**
 * Given an executable name, it will find where it is installed on the system.
 * It first try to search it system-wide, then in the extension storage.
 * @param executable
 */
export async function whereBinary(storagePath: string, executable: string): Promise<string> {
  const PATH = getEnvPATH() ?? '';
  // grab full path for Linux and mac
  if (extensionApi.env.isLinux || extensionApi.env.isMac) {
    try {
      const { stdout: fullPath } = await extensionApi.process.exec('which', [executable], { env: { PATH } });
      return fullPath;
    } catch (err) {
      console.warn('Error getting full path', err);
    }
  } else if (extensionApi.env.isWindows) {
    // grab full path for Windows
    try {
      const { stdout: fullPath } = await extensionApi.process.exec('where.exe', [executable], {
        env: { PATH },
      });
      // remove all line break/carriage return characters from full path
      return fullPath.replace(/(\r\n|\n|\r)/gm, '');
    } catch (err) {
      console.warn('Error getting full path', err);
    }
  }

  // if it's not installed system wide it uses the extension storage path
  return resolve(storagePath, 'bin', executable);
}

function getEnvPATH(): string | undefined {
  const env = process.env;
  if (extensionApi.env.isMac) {
    if (!env.PATH) {
      return macosExtraPath;
    } else {
      return env.PATH.concat(':').concat(macosExtraPath);
    }
  } else {
    return env.PATH;
  }
}

export function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String(err.message);
  } else if (typeof err === 'string') {
    return err;
  }
  return '';
}

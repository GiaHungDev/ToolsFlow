const fs = require('fs');
const path = require('path');
const { encrypt } = require('./encryption.js');

class AccountManager {
    constructor(userDataPath) {
        this.userDataPath = userDataPath || process.cwd();
        this.accountsFilePath = path.join(this.userDataPath, 'accounts.json');
        this.accounts = this.loadAccounts();
    }

    loadAccounts() {
        try {
            if (fs.existsSync(this.accountsFilePath)) {
                const data = fs.readFileSync(this.accountsFilePath, 'utf8');
                const parsed = JSON.parse(data);
                const normalized = this.normalizeAccountsArray(Array.isArray(parsed) ? parsed : []);
                if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
                    this.accounts = normalized;
                    this.saveAccounts();
                }
                return normalized;
            }
        } catch (error) {
            console.error('Error loading accounts:', error);
        }
        return [];
    }

    saveAccounts() {
        try {
            fs.writeFileSync(this.accountsFilePath, JSON.stringify(this.normalizeAccountsArray(this.accounts), null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving accounts:', error);
        }
    }

    normalizeAccountsArray(accounts) {
        const normalized = accounts.map((account, index) => this.normalizeAccount(account, index));
        const groups = new Map();

        for (const account of normalized) {
            // standalone accounts always get their own isolated group (own browser)
            if (account.standalone) {
                account.sessionGroupId = String(account.id);
                account.isSessionClone = false;
                account.parentAccountId = undefined;
                account.sessionIndex = 1;
                groups.set(account.sessionGroupId, [account]);
                continue;
            }
            const rootId = account.isSessionClone && account.parentAccountId
                ? String(account.parentAccountId)
                : String(account.id);
            const groupId = account.sessionGroupId || rootId;
            account.sessionGroupId = groupId;
            if (!groups.has(groupId)) groups.set(groupId, []);
            groups.get(groupId).push(account);
        }

        for (const family of groups.values()) {
            family.sort((a, b) => {
                const aRoot = a.isSessionClone ? 1 : 0;
                const bRoot = b.isSessionClone ? 1 : 0;
                if (aRoot !== bRoot) return aRoot - bRoot;
                return String(a.id).localeCompare(String(b.id));
            });

            let sessionIndex = 1;
            const root = family.find(acc => !acc.isSessionClone) || family[0];
            for (const account of family) {
                account.sessionGroupId = root.sessionGroupId || String(root.id);
                if (String(account.id) === String(root.id)) {
                    account.isSessionClone = false;
                    account.parentAccountId = undefined;
                    account.sessionIndex = 1;
                } else {
                    account.isSessionClone = true;
                    account.parentAccountId = String(root.id);
                    sessionIndex += 1;
                    account.sessionIndex = Math.max(2, sessionIndex - 0);
                }
            }
        }

        return normalized;
    }

    normalizeAccount(accountData, index = 0) {
        const fallbackId = String(Date.now() + index);
        const id = accountData?.id !== undefined && accountData?.id !== null
            ? String(accountData.id)
            : fallbackId;
        const email = accountData?.email || '';
        const profileName = accountData?.profileName || (email ? email.split('@')[0] : `Profile ${index + 1}`);
        const isSessionClone = !!accountData?.isSessionClone || !!accountData?.parentAccountId;
        const sessionGroupId = accountData?.sessionGroupId
            ? String(accountData.sessionGroupId)
            : (accountData?.parentAccountId ? String(accountData.parentAccountId) : id);
        const sessionIndex = Number.isInteger(accountData?.sessionIndex) && accountData.sessionIndex > 0
            ? accountData.sessionIndex
            : (isSessionClone ? 2 : 1);

        return {
            id,
            profileName,
            email,
            password: accountData?.password || '',
            twoFactorSecret: accountData?.twoFactorSecret || '',
            profilePath: accountData?.profilePath || this.buildProfilePath({ email, profileName, id, sessionIndex }),
            hasProfile: !!accountData?.hasProfile,
            loginType: accountData?.loginType || 'auto',
            status: accountData?.status || 'Pending',
            createdAt: accountData?.createdAt || new Date().toISOString(),
            parentAccountId: isSessionClone && accountData?.parentAccountId ? String(accountData.parentAccountId) : undefined,
            sessionGroupId,
            sessionIndex,
            isSessionClone,
            standalone: !!accountData?.standalone,
            proxy: accountData?.proxy || '',
        };
    }

    buildProfilePath({ email = '', profileName = '', id = '', sessionIndex = 1 }) {
        // Always use unique ID to guarantee a fresh browser profile folder
        return `profile_${id}`;
    }

    getAccounts() {
        return this.normalizeAccountsArray(this.accounts);
    }

    getAccountById(id) {
        if (id === undefined || id === null) return null;
        const normalizedId = String(id);
        return this.accounts.find(acc => String(acc.id) === normalizedId) || null;
    }

    getRootAccount(accountId) {
        const account = this.getAccountById(accountId);
        if (!account) return null;
        return account.isSessionClone && account.parentAccountId
            ? this.getAccountById(account.parentAccountId)
            : account;
    }

    getSessionFamily(accountId) {
        const root = this.getRootAccount(accountId);
        if (!root) return [];
        const rootId = String(root.id);
        return this.getAccounts()
            .filter(acc => String(acc.id) === rootId || String(acc.parentAccountId || '') === rootId)
            .sort((a, b) => (a.sessionIndex || 1) - (b.sessionIndex || 1));
    }

    addAccount(accountData) {
        const password = accountData.password
            ? (String(accountData.password).includes(':') ? accountData.password : encrypt(accountData.password))
            : '';
        const twoFactorSecret = accountData.twoFactorSecret
            ? (String(accountData.twoFactorSecret).includes(':') ? accountData.twoFactorSecret : encrypt(String(accountData.twoFactorSecret).replace(/\s+/g, '')))
            : '';
        const newAccount = this.normalizeAccount({
            id: Date.now().toString(),
            profileName: accountData.profileName,
            email: accountData.email || '',
            password,
            twoFactorSecret,
            profilePath: accountData.profilePath,
            hasProfile: accountData.hasProfile || false,
            loginType: accountData.loginType || 'auto',
            status: accountData.status || 'Pending',
            createdAt: new Date().toISOString(),
            parentAccountId: accountData.parentAccountId,
            sessionGroupId: accountData.sessionGroupId,
            sessionIndex: accountData.sessionIndex,
            isSessionClone: accountData.isSessionClone || false,
        }, this.accounts.length);

        this.accounts.push(newAccount);
        this.accounts = this.normalizeAccountsArray(this.accounts);
        this.saveAccounts();
        return newAccount;
    }

    createSessionClone(accountId) {
        const rootAccount = this.getRootAccount(accountId);
        if (!rootAccount) throw new Error('Parent account not found');

        const family = this.getSessionFamily(rootAccount.id);
        const nextSessionIndex = Math.max(1, ...family.map(acc => Number(acc.sessionIndex) || 1)) + 1;
        const clone = this.addAccount({
            profileName: `${rootAccount.profileName || rootAccount.email || 'Profile'} [Session ${nextSessionIndex}]`,
            email: rootAccount.email,
            password: rootAccount.password,
            twoFactorSecret: rootAccount.twoFactorSecret,
            loginType: rootAccount.loginType || 'auto',
            profilePath: this.buildProfilePath({
                email: rootAccount.email,
                profileName: rootAccount.profileName,
                id: `${rootAccount.id}_${nextSessionIndex}`,
                sessionIndex: nextSessionIndex,
            }),
            hasProfile: false,
            status: 'Pending',
            parentAccountId: String(rootAccount.id),
            sessionGroupId: rootAccount.sessionGroupId || String(rootAccount.id),
            sessionIndex: nextSessionIndex,
            isSessionClone: true,
        });

        return clone;
    }

    updateAccount(id, updateData) {
        const normalizedId = String(id);
        const index = this.accounts.findIndex(acc => String(acc.id) === normalizedId);
        if (index !== -1) {
            const current = this.accounts[index];
            const mergedData = { ...updateData };
            if (updateData.password !== undefined && updateData.password !== null && updateData.password !== '') {
                if (!current.password || !String(updateData.password).includes(':')) {
                    mergedData.password = encrypt(updateData.password);
                }
            }
            if (updateData.twoFactorSecret !== undefined && updateData.twoFactorSecret !== null && updateData.twoFactorSecret !== '') {
                if (!current.twoFactorSecret || !String(updateData.twoFactorSecret).includes(':')) {
                    mergedData.twoFactorSecret = encrypt(String(updateData.twoFactorSecret).replace(/\s+/g, ''));
                }
            }

            this.accounts[index] = this.normalizeAccount({ ...current, ...mergedData }, index);
            this.accounts = this.normalizeAccountsArray(this.accounts);
            this.saveAccounts();
            return this.getAccountById(normalizedId);
        }
        return null;
    }

    deleteAccount(id, currentMapping = {}) {
        const account = this.getAccountById(id);
        if (!account) return false;

        const normalizedMappingValues = new Set(Object.values(currentMapping || {}).map(v => String(v)));
        const deleteSet = new Set();

        if (account.isSessionClone) {
            deleteSet.add(String(account.id));
        } else {
            for (const member of this.getSessionFamily(account.id)) {
                deleteSet.add(String(member.id));
            }
        }

        for (const mappedId of normalizedMappingValues) {
            if (deleteSet.has(mappedId)) {
                throw new Error('Không thể xóa tài khoản/phiên đang được gán cho worker. Vui lòng gỡ gán trước!');
            }
        }

        const toDelete = this.accounts.filter(acc => deleteSet.has(String(acc.id)));
        this.accounts = this.accounts.filter(acc => !deleteSet.has(String(acc.id)));
        this.accounts = this.normalizeAccountsArray(this.accounts);
        this.saveAccounts();

        for (const target of toDelete) {
            const baseDir = process.env.USER_DATA_PATH || path.resolve(__dirname, '../../user_data');

            if (target.chromeProfilePath) {
                const nativeProfilePath = path.join(baseDir, 'chrome_profiles', target.chromeProfilePath.replace(/\s+/g, '_'));
                if (fs.existsSync(nativeProfilePath)) {
                    try {
                        fs.rmSync(nativeProfilePath, { recursive: true, force: true });
                    } catch (e) {
                        console.error(`Failed to delete native profile folder for ${target.profileName}:`, e.message);
                    }
                }
            } else if (target.profilePath) {
                const fullProfilePath = path.join(baseDir, target.profilePath);
                if (fs.existsSync(fullProfilePath)) {
                    try {
                        fs.rmSync(fullProfilePath, { recursive: true, force: true });
                    } catch (e) {
                        console.error(`Failed to delete profile folder for ${target.profileName}:`, e.message);
                    }
                }
            }
        }

        return true;
    }
}

module.exports = AccountManager;

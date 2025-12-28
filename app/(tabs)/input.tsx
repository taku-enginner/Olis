import { zodResolver } from '@hookform/resolvers/zod';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as z from 'zod';

import { makeRedirectUri, useAuthRequest } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = __DEV__ 
  ? process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID_DEV 
  : process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID_PROD;

const CLIENT_SECRET = __DEV__
  ? process.env.EXPO_PUBLIC_GITHUB_CLIENT_SECRET_DEV
  : process.env.EXPO_PUBLIC_GITHUB_CLIENT_SECRET_PROD;

const discovery = {
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint:         'https://github.com/login/oauth/access_token',
    revocationEndpoint:    'https://github.com/settings/connections/applications/' + CLIENT_ID,
};

// バリデーションルール定義
const schema = z.object({
    owner: z.string().min(1, 'リポジトリ名は１文字以上で入力してください'),
    repo:  z.string().min(1, 'issueタイトルは１文字以上で入力してください'),
    title: z.string().min(1, 'タイトルは１文字以上で入力してください')
})

// 保存ボタン用（titleのみ）
const saveSchema = z.object({
    title: z.string().min(1, 'タイトルは１文字以上で入力してください')
})

// z.inferで、Zodのルールから自動的に型を作る
type FormData     = z.infer<typeof schema>; // ?
type SaveFormData = z.infer<typeof saveSchema>;

export default function App(){
    const insets = useSafeAreaInsets();
    const [history, setHistory]           = useState<string[]>([]);
    const [accessToken, setAccessToken]   = useState<string | null>(null);
    const [loading, setLoading]           = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [repoOwner, setRepoOwner]       = useState('');
    const [repoName, setRepoName]         = useState('');
    const [userName, setUserName]         = useState('');
    const [repositories, setRepositories] = useState<Array<{name: string; owner: string; usage?: number}>>([]);
    const [loadingRepos, setLoadingRepos] = useState(false);
    const [filteredRepos, setFilteredRepos] = useState<Array<{name: string; owner: string; usage?: number}>>([]);
    const [showRepoSuggestions, setShowRepoSuggestions] = useState(false);
    const [repoUsageMap, setRepoUsageMap] = useState<Record<string, number>>({});

    // 開発環境と本番環境でリダイレクトURIを切り替え
    // 本番環境では、GitHub OAuthアプリの設定で登録されているリダイレクトURIと完全一致させる必要がある
    const redirectUri =  
        makeRedirectUri({
            scheme: 'exp+offlimitedissue',
            path: 'redirect',
            // preferLocalhost: __DEV__,
        });

    const [request, response, promptAsync] = useAuthRequest(
        {
            clientId:    CLIENT_ID ?? "",
            scopes:      ['repo', 'user'],
            redirectUri: redirectUri,
            usePKCE: false,
        },
        discovery
    );

    // 認証レスポンス監視
    useEffect(() => {
        if (response?.type === 'success' && !accessToken && 'params' in response) {
            const { code } = response.params;
            exchangeCodeForToken(code);
        }
    }, [response, accessToken]);


    // トークン交換
    const exchangeCodeForToken = async (code: string) => {
        try {
            const res = await fetch('https://github.com/login/oauth/access_token', {
                method:  'POST',
                headers: { 
                    'Accept':       'application/json',
                    'Content-Type': 'application/json',
                 },
                body: JSON.stringify({
                    client_id:     CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    code:          code,
                }),
            });
            const data = await res.json();
            if (data.access_token) {
                setAccessToken(data.access_token);
                // トークンを取得したら、ユーザー情報を取得してリポジトリ一覧を読み込む
                await fetchUserAndRepositories(data.access_token);
                Alert.alert("認証成功", "GitHub連携が完了しました");
            }
        } catch (e) {
            Alert.alert("エラー", "認証に失敗しました");
        }
    };

    // GitHubユーザー情報とリポジトリ一覧を取得
    const fetchUserAndRepositories = async (token: string) => {
        try {
            // ユーザー情報を取得
            const userRes = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                },
            });
            const userData = await userRes.json();
            if (userData.login) {
                setUserName(userData.login);
                setRepoOwner(userData.login);
                setValue('owner', userData.login);
            }

            // 使用頻度を読み込む
            const savedUsage = await AsyncStorage.getItem('@repo_usage_map');
            if (savedUsage) {
                setRepoUsageMap(JSON.parse(savedUsage));
            }

            // ユーザーのリポジトリ一覧を取得
            setLoadingRepos(true);
            const reposRes = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                },
            });
            const reposData = await reposRes.json();
            if (Array.isArray(reposData)) {
                const repoList = reposData.map((repo: any) => {
                    const key = `${repo.owner.login}/${repo.name}`;
                    const usage = savedUsage ? JSON.parse(savedUsage)[key] || 0 : 0;
                    return {
                        name: repo.name,
                        owner: repo.owner.login,
                        usage,
                    };
                });
                setRepositories(repoList);
                // 最初はよく使うリポジトリ5つを表示
                const topRepos = repoList
                    .sort((a, b) => (b.usage || 0) - (a.usage || 0))
                    .slice(0, 5);
                setFilteredRepos(topRepos);
            }
            setLoadingRepos(false);
        } catch (error) {
            console.error('Failed to fetch user and repositories:', error);
            setLoadingRepos(false);
        }
    };

    // リポジトリ名で検索・フィルタリング
    const handleRepoNameChange = (text: string) => {
        setRepoName(text);
        
        if (text.trim() === '') {
            // 入力が空の場合はよく使う5つを表示
            const topRepos = repositories
                .sort((a, b) => (b.usage || 0) - (a.usage || 0))
                .slice(0, 5);
            setFilteredRepos(topRepos);
        } else {
            // 入力に基づいてフィルタリング
            const filtered = repositories
                .filter(repo => repo.name.toLowerCase().includes(text.toLowerCase()))
                .sort((a, b) => (b.usage || 0) - (a.usage || 0))
                .slice(0, 5); // 上位5つまで表示
            setFilteredRepos(filtered);
        }
        setShowRepoSuggestions(true);
    };

    // リポジトリを選択
    const selectRepository = (owner: string, name: string) => {
        setRepoOwner(owner);
        setRepoName(name);
        setValue('owner', owner);
        setValue('repo', name);
        
        // 使用頻度を記録
        const key = `${owner}/${name}`;
        const newUsageMap = {
            ...repoUsageMap,
            [key]: (repoUsageMap[key] || 0) + 1,
        };
        setRepoUsageMap(newUsageMap);
        AsyncStorage.setItem('@repo_usage_map', JSON.stringify(newUsageMap));
        
        setShowRepoSuggestions(false);
    };

    const createGitHubIssue = async (title: string) => {
        if (!accessToken) {
            Alert.alert("エラー", "先にGitHubログインをしてください");
            return;
        }
        const {owner, repo} = getValues();
        setLoading(true);
        try {
            const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
                method: 'POST',
                headers: {
                    Authorization:  `Bearer ${accessToken}`,
                    Accept:         'application/vnd.github+json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ title: title, body: 'Appから送信' }),
            });
            if (res.ok) {
                Alert.alert("成功", "GitHubにIssueを作成しました！");
            } else {
                Alert.alert("失敗", "Issueの作成に失敗しました");
            }
        } catch (e) {
            Alert.alert("エラー", "通信失敗");
            console.log(e);
        } finally {
            setLoading(false);
        }
    };

    //  react hook form セットアップ
    // control: 配線、 handleSubmit:送信時のチェック、 formState:フォームがどんな状態か教えてくれる
    // getValues を追加
    const { control, handleSubmit, reset, getValues, setValue, setError, formState: { errors } } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: {
            owner: '',
            repo:  '',
            title: '',
        }
    });
    // 初回データの読み込み
    useEffect(() => {
        loadHistory();
        loadRepoInfo();
    }, []);

    const loadHistory = async () => {
        const saved = await AsyncStorage.getItem('@history_list');
        if (saved) {
            setHistory(JSON.parse(saved)); // 文字列を配列に戻す
        }
    }

    const loadRepoInfo = async () => {
        const savedOwner = await AsyncStorage.getItem('@repo_owner');
        const savedRepo  = await AsyncStorage.getItem('@repo_name');
        if (savedOwner) {
            setRepoOwner(savedOwner);
            setValue('owner', savedOwner);
        }
        if (savedRepo) {
            setRepoName(savedRepo);
            setValue('repo', savedRepo);
        }
    }

    const handleModalOpen = async () => {
        setRepoOwner(getValues('owner') || '');
        setRepoName(getValues('repo') || '');
        
        // アクセストークンがあれば、リポジトリ一覧を取得
        if (accessToken && repositories.length === 0) {
            setLoadingRepos(true);
            try {
                const reposRes = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: 'application/vnd.github+json',
                    },
                });
                const reposData = await reposRes.json();
                if (Array.isArray(reposData)) {
                    const repoList = reposData.map((repo: any) => ({
                        name: repo.name,
                        owner: repo.owner.login,
                    }));
                    setRepositories(repoList);
                }
            } catch (error) {
                console.error('Failed to fetch repositories:', error);
            } finally {
                setLoadingRepos(false);
            }
        }
        setModalVisible(true);
    };

    const onSave = async (data: SaveFormData) => {
        const newHistory = [data.title, ...history];
        setHistory(newHistory);

        await AsyncStorage.setItem('@history_list', JSON.stringify(newHistory));
        setValue('title', '');
    };

    const handleSave = async () => {
        const titleValue = getValues('title');
        const result     = saveSchema.safeParse({ title: titleValue });
        
        if (!result.success) {
            // titleのエラーのみ表示
            const titleError = result.error.issues.find((e: z.ZodIssue) => e.path[0] === 'title');
            if (titleError) {
                setError('title', {
                    type: 'manual',
                    message: titleError.message || 'タイトルは１文字以上で入力してください'
                });
            }
            return;
        }
        
        // エラーをクリア
        setValue('title', titleValue, { shouldValidate: false });
        await onSave(result.data);
    };

    const confirmDelete = (index: number) => {
        Alert.alert(
            "確認",
            "この項目を削除してもよろしいですか？",
            [
                {text: "キャンセル", style: "cancel"},
                {text: "削除", style: "destructive", onPress: () => deleteItem(index)}
            ]
        )
    }
    const deleteItem = async (index: number) => {
        const newHistory = history.filter((_,i) => i !== index);

        setHistory(newHistory);
        await AsyncStorage.setItem('@histry_list', JSON.stringify(newHistory));
    }

    const onGitHubSubmit = async () => {
        if (!accessToken) {
            Alert.alert("認証が必要", "まずGitHubでログインしてください");
            return;
        }
    
        if (history.length === 0) {
            Alert.alert("データなし", "送信する項目がありません");
            return;
        }
    
        setLoading(true);
        const failedItems: string[] = [];
        let successCount = 0;
        let failCount = 0;
    
        try {
            // 全ての項目を順番に送信して結果を追跡
            for (const title of history) {
                try {
                    // GitHub Issue作成の実際の処理
                    const res = await fetch(
                        `https://api.github.com/repos/${repoOwner}/${repoName}/issues`,
                        {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                                Accept: 'application/vnd.github+json',
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ title: title, body: 'Appから送信' }),
                        }
                    );

                    if (res.ok) {
                        // 成功
                        successCount++;
                    } else {
                        // HTTPエラー - 失敗したアイテムを保存
                        failedItems.push(title);
                        failCount++;
                    }
                } catch (error) {
                    // ネットワークエラーなど - 失敗したアイテムを保存
                    failedItems.push(title);
                    failCount++;
                }
            }

            // 失敗したアイテムのみを下書きリストに残す
            setHistory(failedItems);
            if (failedItems.length > 0) {
                await AsyncStorage.setItem('@history_list', JSON.stringify(failedItems));
            } else {
                await AsyncStorage.removeItem('@history_list');
            }

            // 結果を表示
            if (failCount === 0) {
                Alert.alert("送信完了", `${successCount}件のIssueを作成しました`);
            } else if (successCount === 0) {
                Alert.alert("送信失敗", `全${failCount}件の送信に失敗しました\n失敗した下書きはリストに残っています`);
            } else {
                Alert.alert("送信完了", `成功: ${successCount}件\n失敗: ${failCount}件\n\n失敗した下書きはリストに残っています`);
            }
            
        } catch (e) {
            Alert.alert("エラー", "処理中にエラーが発生しました");
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={[styles.container, {paddingTop: insets.top}]}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Issue作成</Text>
                <TouchableOpacity 
                    style={styles.repoButton}
                    onPress={handleModalOpen}
                >
                    <Text style={styles.repoButtonText}>
                        {repoOwner && repoName ? `${repoOwner}/${repoName}` : 'リポジトリ設定'}
                    </Text>
                </TouchableOpacity>
            </View>
            <ScrollView 
                style={styles.scrollView}
                contentContainerStyle={styles.contentContainer}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.formSection}>
                    <View style={styles.inputGroup}>
                    <Text style={styles.label}>Issueタイトル</Text>
                    <Controller
                        control={control}
                        name="title"
                        render={({field: {onChange, onBlur, value}}) => (
                            <TextInput
                                style={[
                                    styles.input,
                                    errors.title && styles.inputError
                                ]}
                                placeholder="Issueのタイトルを入力してください"
                                placeholderTextColor="#9CA3AF"
                                onBlur={onBlur}
                                value={value}
                                onChangeText={onChange}
                                autoCapitalize="none"
                                autoCorrect={false}
                                spellCheck={false}
                            />
                        )}
                    />
                    {errors.title && (
                        <Text style={styles.errorText}>{errors.title.message}</Text>
                    )}
                </View>

                <TouchableOpacity 
                    style={styles.primaryButton}
                    onPress={handleSave}
                >
                    <Text style={styles.primaryButtonText}>保存</Text>
                </TouchableOpacity>
            </View>

            {history.length > 0 && (
                <View style={styles.historySection}>
                    <Text style={styles.sectionTitle}>下書き一覧</Text>
                    <View style={styles.historyList}>
                        {history.map((item, index) => (
                            <View key={index} style={styles.historyCard}>
                                <Text style={styles.historyItemText}>{item}</Text>
                                <TouchableOpacity
                                    style={styles.deleteButton}
                                    onPress={() => confirmDelete(index)}
                                >
                                    <Text style={styles.deleteButtonText}>削除</Text>
                                </TouchableOpacity>
                            </View>
                        ))}
                    </View>
                </View>
            )}
            </ScrollView>

            <View style={[styles.footer, {paddingBottom: insets.bottom, bottom: insets.bottom + 50}]}>
                {!accessToken ? (
                    <TouchableOpacity 
                        style={styles.githubButton}
                        onPress={() => promptAsync()}
                    >
                        <Text style={styles.githubButtonText}>GitHubでログイン</Text>
                    </TouchableOpacity>
                ) : (
                    <>
                        {history.length > 0 && (
                            <TouchableOpacity 
                                style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                                onPress={onGitHubSubmit}
                                disabled={loading}
                            >
                                <Text style={styles.submitButtonText}>
                                    {loading ? "送信中..." : `${history.length}件をGitHubに一括送信`}
                                </Text>
                            </TouchableOpacity>
                        )}
                        <View style={styles.authStatusCard}>
                            <View style={styles.authStatusIndicator} />
                            <Text style={styles.authStatusText}>GitHubに接続済み</Text>
                            <TouchableOpacity 
                                style={styles.logoutButton}
                                onPress={() => {
                                    setAccessToken(null);
                                    Alert.alert("ログアウト", "認証情報をクリアしました。");
                                }}
                            >
                                <Text style={styles.logoutButtonText}>ログアウト</Text>
                            </TouchableOpacity>
                        </View>
                    </>
                )}
            </View>

            {/* <View style={[styles.adBanner, {bottom: 0, paddingBottom: insets.bottom}]}>
                <View style={styles.adBannerContent}>
                    <Text style={styles.adBannerText}>広告</Text>
                </View>
            </View> */}

            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>リポジトリ情報</Text>
                            <TouchableOpacity
                                style={styles.modalCloseButton}
                                onPress={() => setModalVisible(false)}
                            >
                                <Text style={styles.modalCloseButtonText}>✕</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.modalBody}>
                            {!accessToken ? (
                                <Text style={styles.noAuthText}>GitHubにサインインしてリポジトリを選択してください</Text>
                            ) : (
                                <>
                                    <View style={styles.inputGroup}>
                                        <Text style={styles.label}>ユーザー名</Text>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="GitHub ユーザー名"
                                            placeholderTextColor="#9CA3AF"
                                            value={userName}
                                            onChangeText={setUserName}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            spellCheck={false}
                                        />
                                    </View>

                                    <View style={styles.inputGroup}>
                                        <Text style={styles.label}>リポジトリ名</Text>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="リポジトリ名を入力..."
                                            placeholderTextColor="#9CA3AF"
                                            value={repoName}
                                            onChangeText={handleRepoNameChange}
                                            onFocus={() => {
                                                if (repositories.length > 0) {
                                                    setShowRepoSuggestions(true);
                                                }
                                            }}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            spellCheck={false}
                                        />

                                        {showRepoSuggestions && filteredRepos.length > 0 && (
                                            <View style={styles.suggestionsList}>
                                                {filteredRepos.map((repo, index) => (
                                                    <TouchableOpacity
                                                        key={index}
                                                        style={styles.suggestionItem}
                                                        onPress={() => selectRepository(repo.owner, repo.name)}
                                                    >
                                                        <Text style={styles.suggestionItemText}>
                                                            {repo.name}
                                                        </Text>
                                                        {(repo.usage || 0) > 0 && (
                                                            <Text style={styles.suggestionUsageText}>
                                                                ★ {repo.usage}
                                                            </Text>
                                                        )}
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        )}

                                        {showRepoSuggestions && repositories.length === 0 && (
                                            <View style={styles.suggestionsList}>
                                                <View style={styles.suggestionItem}>
                                                    <Text style={styles.noReposText}>リポジトリを読み込み中...</Text>
                                                </View>
                                            </View>
                                        )}
                                    </View>

                                    {repoName && (
                                        <TouchableOpacity 
                                            style={styles.modalSaveButton}
                                            onPress={() => {
                                                setRepoOwner(userName);
                                                setValue('owner', userName);
                                                setModalVisible(false);
                                            }}
                                        >
                                            <Text style={styles.modalSaveButtonText}>完了</Text>
                                        </TouchableOpacity>
                                    )}
                                </>
                            )}
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
        letterSpacing: -0.5,
    },
    repoButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        backgroundColor: '#F3F4F6',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    repoButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#3B82F6',
        letterSpacing: -0.2,
    },
    scrollView: {
        flex: 1,
    },
    contentContainer: {
        padding: 20,
        paddingBottom: 180,
    },
    formSection: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 20,
        letterSpacing: -0.5,
    },
    inputGroup: {
        marginBottom: 20,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
        letterSpacing: -0.2,
    },
    input: {
        height: 52,
        backgroundColor: '#FFFFFF',
        borderWidth: 1.5,
        borderColor: '#E5E7EB',
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 16,
        color: '#111827',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    inputError: {
        borderColor: '#EF4444',
        backgroundColor: '#FEF2F2',
    },
    errorText: {
        fontSize: 12,
        color: '#EF4444',
        marginTop: 6,
        marginLeft: 4,
    },
    primaryButton: {
        backgroundColor: '#3B82F6',
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#3B82F6',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 12,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: -2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 8,
    },
    adBanner: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 50,
        backgroundColor: '#F3F4F6',
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
        justifyContent: 'center',
        alignItems: 'center',
    },
    adBannerContent: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    adBannerText: {
        fontSize: 12,
        color: '#9CA3AF',
        fontWeight: '500',
    },
    githubButton: {
        backgroundColor: '#24292E',
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    githubButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    authStatusCard: {
        backgroundColor: '#F9FAFB',
        padding: 12,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    authStatusIndicator: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#10B981',
        marginRight: 12,
    },
    authStatusText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
        color: '#111827',
    },
    logoutButton: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: '#FEF2F2',
    },
    logoutButtonText: {
        color: '#EF4444',
        fontSize: 12,
        fontWeight: '600',
    },
    submitButton: {
        backgroundColor: '#10B981',
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
        shadowColor: '#10B981',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    submitButtonDisabled: {
        opacity: 0.6,
    },
    submitButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    historySection: {
        marginTop: 8,
    },
    historyList: {
        gap: 12,
    },
    historyCard: {
        backgroundColor: '#FFFFFF',
        padding: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    historyItemText: {
        flex: 1,
        fontSize: 15,
        color: '#111827',
        lineHeight: 22,
    },
    deleteButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: '#FEF2F2',
        marginLeft: 12,
    },
    deleteButtonText: {
        color: '#EF4444',
        fontSize: 13,
        fontWeight: '600',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-start',
        paddingTop: 60,
    },
    modalContent: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        paddingTop: 20,
        maxHeight: '70%',
        marginHorizontal: 20,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
        letterSpacing: -0.5,
    },
    modalCloseButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#F3F4F6',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalCloseButtonText: {
        fontSize: 18,
        color: '#6B7280',
        fontWeight: '600',
    },
    modalBody: {
        padding: 20,
        maxHeight: '80%',
    },
    noAuthText: {
        fontSize: 14,
        color: '#6B7280',
        textAlign: 'center',
        marginVertical: 20,
    },
    suggestionsList: {
        maxHeight: 250,
        marginTop: 8,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 8,
        borderTopWidth: 0,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
    },
    suggestionItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    suggestionItemText: {
        fontSize: 14,
        color: '#111827',
        flex: 1,
    },
    suggestionUsageText: {
        fontSize: 12,
        color: '#F59E0B',
        fontWeight: '600',
        marginLeft: 8,
    },
    noReposText: {
        fontSize: 14,
        color: '#9CA3AF',
    },
    modalSaveButton: {
        backgroundColor: '#3B82F6',
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 20,
        shadowColor: '#3B82F6',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    modalSaveButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
});
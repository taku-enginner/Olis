import { useState } from "react";
import { Alert, Button, Text, TextInput, View } from "react-native";

export default function App(){
    const [title, setTitle] = useState(''); //()はデフォルト値
    const handleTitle = () => {
        Alert.alert('タイトル', title);
    };

    return (
        <View style={{flex: 1, padding: 20, justifyContent: 'center', backgroundColor: "#fff"}}>
            <Text style={{fontSize: 16, marginBottom: 8, fontWeight: 'bold'}}>タイトル</Text>
            <TextInput
                style={{height:50, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 15, marginBottom: 20}}
                placeholder="issueタイトルを入力してください"
                value={title}
                onChangeText={setTitle} // 文字が変わるたびに実行される関数
                autoCapitalize="none"
            />
            <View style={{marginTop: 10}}>
                <Button title="保存" onPress={handleTitle} />
            </View>
        </View>
    );
}
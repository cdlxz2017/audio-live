#!/usr/bin/env python3
"""extract_code.py - 提取代码结构（类、函数、关系）为 JSON"""

import sys
import re
import json
import hashlib
from pathlib import Path


def camel_to_words(s):
    """将 CamelCase 转为空格分隔的单词"""
    words = re.sub(r'([a-z])([A-Z])', r'\1 \2', s)
    return words.lower()


def generate_tags(name, node_type):
    """根据名称和类型生成语义标签"""
    tags = set()
    tags.add(node_type)
    
    # 英文标签
    ENGLISH_TAGS = {
        'manager': 'manager|管理器', 'handler': 'handler|处理器', 'service': 'service|服务',
        'engine': 'engine|引擎', 'router': 'router|路由', 'controller': 'controller|控制器',
        'middleware': 'middleware|中间件', 'plugin': 'plugin|插件', 'worker': 'worker|工作者',
        'client': 'client|客户端', 'server': 'server|服务端', 'builder': 'builder|构建器',
        'factory': 'factory|工厂', 'parser': 'parser|解析器', 'validator': 'validator|验证器',
        'formatter': 'formatter|格式化器', 'converter': 'converter|转换器', 'checker': 'checker|检查器',
        'cache': 'cache|缓存', 'database': 'database|db|数据库', 'auth': 'auth|认证|授权',
        'api': 'api|接口', 'session': 'session|会话', 'config': 'config|配置',
        'test': 'test|测试', 'util': 'util|工具', 'helper': 'helper|辅助',
    }
    
    name_lower = name.lower()
    for key, tag_list in ENGLISH_TAGS.items():
        if key in name_lower:
            for t in tag_list.split('|'):
                tags.add(t)
    
    # CamelCase 分词
    words = camel_to_words(name).split()
    for w in words:
        if len(w) > 2:
            tags.add(w)
    
    # 中文翻译
    CN_TAGS = {
        '管理': '管理器', '处理': '处理器', '服务': 'service', '引擎': 'engine',
        '路由': 'router', '控制': 'controller', '中间': 'middleware', '插件': 'plugin',
        '工作': 'worker', '缓存': 'cache', '数据库': 'database', '认证': 'auth',
        '授权': 'auth', '接口': 'api', '会话': 'session', '配置': 'config',
        '测试': 'test', '工具': 'util', '辅助': 'helper', '验证': 'validator',
        '格式化': 'formatter', '转换': 'converter', '构建': 'builder',
    }
    for cn, en in CN_TAGS.items():
        if cn in name:
            tags.add(en)
    
    return list(tags)[:15]


def extract_python(source):
    """提取 Python 代码结构"""
    nodes = []
    edges = []
    
    # 匹配类定义
    class_pattern = re.compile(r'^class\s+(\w+)\s*(?:\(([^)]+)\))?\s*:', re.MULTILINE)
    # 匹配函数定义（包括 async）
    func_pattern = re.compile(r'^(?:async\s+)?def\s+(\w+)\s*\(', re.MULTILINE)
    
    source_lines = source.split('\n')
    
    # 找类
    classes = []
    for m in class_pattern.finditer(source):
        name = m.group(1)
        base_classes = m.group(2) or ''
        line = source[:m.start()].count('\n') + 1
        node_id = f'py_class_{abs(hash(name)) % 100000}'
        node = {
            'id': node_id,
            'name': name,
            'type': 'class_definition',
            'start_line': line,
            'tags': generate_tags(name, '类定义')
        }
        nodes.append(node)
        classes.append((name, line, node_id, base_classes))
    
    # 找函数
    for m in func_pattern.finditer(source):
        name = m.group(1)
        line = source[:m.start()].count('\n') + 1
        # 跳过类内的方法（行的缩进大于类的开始行）
        in_class = False
        for cls_name, cls_line, cls_id, _ in classes:
            if line > cls_line:
                in_class = True
                edges.append({'source': cls_id, 'target': f'py_func_{abs(hash(name)) % 100000}'})
                break
        
        if not in_class and not name.startswith('_'):
            node_id = f'py_func_{abs(hash(name)) % 100000}'
            nodes.append({
                'id': node_id,
                'name': name,
                'type': 'function_definition',
                'start_line': line,
                'tags': generate_tags(name, '函数定义')
            })
    
    return {'nodes': nodes, 'edges': edges}


def extract_javascript(source):
    """提取 JavaScript/TypeScript 代码结构"""
    nodes = []
    edges = []
    
    # class 定义
    class_pattern = re.compile(r'^class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{', re.MULTILINE)
    # function 定义
    func_pattern = re.compile(r'(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(', re.MULTILINE)
    # const/let/var 函数表达式
    const_func_pattern = re.compile(r'(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>', re.MULTILINE)
    
    source_lines = source.split('\n')
    
    # 类
    classes = []
    for m in class_pattern.finditer(source):
        name = m.group(1)
        line = source[:m.start()].count('\n') + 1
        node_id = f'js_class_{abs(hash(name)) % 100000}'
        nodes.append({
            'id': node_id,
            'name': name,
            'type': 'class_definition',
            'start_line': line,
            'tags': generate_tags(name, '类定义')
        })
        classes.append((name, line, node_id))
    
    # 函数
    for m in func_pattern.finditer(source):
        name = m.group(1)
        line = source[:m.start()].count('\n') + 1
        node_id = f'js_func_{abs(hash(name)) % 100000}'
        nodes.append({
            'id': node_id,
            'name': name,
            'type': 'function_declaration',
            'start_line': line,
            'tags': generate_tags(name, '函数声明')
        })
    
    for m in const_func_pattern.finditer(source):
        name = m.group(1)
        line = source[:m.start()].count('\n') + 1
        node_id = f'js_func_{abs(hash(name)) % 100000}'
        nodes.append({
            'id': node_id,
            'name': name,
            'type': 'function_expression',
            'start_line': line,
            'tags': generate_tags(name, '箭头函数')
        })
    
    return {'nodes': nodes, 'edges': edges}


def extract_json_config(source, file_path=''):
    """将 JSON 配置解析为节点（顶层 key 作为节点）"""
    import json
    nodes = []
    try:
        data = json.loads(source)
    except Exception:
        return {'nodes': [], 'edges': []}

    def add_keys(obj, prefix=''):
        if isinstance(obj, dict):
            for k, v in list(obj.items())[:50]:  # 最多50个顶层key
                node_id = f'json_key_{abs(hash(prefix + k)) % 100000}'
                node = {
                    'id': node_id,
                    'name': k,
                    'type': 'config_key',
                    'start_line': 1,
                    'tags': ['config', 'json', 'key', str(type(v).__name__)],
                    '_value_preview': str(v)[:50] if isinstance(v, str) else None
                }
                nodes.append(node)
                if isinstance(v, dict):
                    add_keys(v, prefix + k + '.')
        elif isinstance(obj, list):
            for i, item in enumerate(obj[:10]):
                if isinstance(item, dict):
                    add_keys(item, prefix + '[]')

    add_keys(data)
    return {'nodes': nodes, 'edges': []}


def extract_yaml_config(source, file_path=''):
    """将 YAML 配置解析为节点（顶级 key 作为节点）"""
    nodes = []
    try:
        import yaml
        data = yaml.safe_load(source)
    except Exception:
        return {'nodes': [], 'edges': []}

    if not isinstance(data, dict):
        return {'nodes': [], 'edges': []}

    def add_keys(obj, prefix=''):
        if isinstance(obj, dict):
            for k, v in list(obj.items())[:50]:
                node_id = f'yaml_key_{abs(hash(prefix + k)) % 100000}'
                tags = ['config', 'yaml', 'key']
                if isinstance(v, str): tags.append('string'); tags.append('value')
                elif isinstance(v, int): tags.append('number')
                elif isinstance(v, bool): tags.append('boolean')
                elif isinstance(v, list): tags.append('array')
                elif isinstance(v, dict): tags.append('object')
                node = {
                    'id': node_id,
                    'name': k,
                    'type': 'config_key',
                    'start_line': 1,
                    'tags': tags,
                    '_value_preview': str(v)[:50] if isinstance(v, str) else None
                }
                nodes.append(node)
                if isinstance(v, dict) and len(nodes) < 100:
                    add_keys(v, prefix + k + '.')
        elif isinstance(obj, list):
            for i, item in enumerate(obj[:10]):
                if isinstance(item, dict):
                    add_keys(item, prefix + '[]')

    add_keys(data)
    return {'nodes': nodes, 'edges': []}


def extract_config(source):
    """JSON 配置提取器"""
    return extract_json_config(source)


def extract_yaml(source):
    """YAML 配置提取器"""
    return extract_yaml_config(source)


EXTRACTORS = {
    '.py': extract_python,
    '.js': extract_javascript,
    '.ts': extract_javascript,
    '.jsx': extract_javascript,
    '.tsx': extract_javascript,
    '.json': extract_config,
    '.yaml': extract_yaml,
    '.yml': extract_yaml,
}


def extract_file(file_path):
    """根据文件扩展名选择提取器"""
    ext = Path(file_path).suffix.lower()
    
    if ext not in EXTRACTORS:
        return None
    
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            source = f.read()
    except Exception:
        return None
    
    if len(source) > 500_000:
        source = source[:500_000]
    
    extractor = EXTRACTORS[ext]
    result = extractor(source)
    
    # 添加文件元数据
    result['file_path'] = file_path
    result['language'] = ext.lstrip('.')
    
    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: extract_code.py <file_path>'}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    result = extract_file(file_path)
    
    if result:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(json.dumps({'nodes': [], 'edges': [], 'file_path': file_path}))

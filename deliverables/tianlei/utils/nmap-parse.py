#!/usr/bin/env python3
# ============================================================
# nmap-parse.py - Nmap XML结果解析器
# 功能：解析Nmap XML输出，提取主机/端口/服务信息，输出JSON
# ============================================================

import xml.etree.ElementTree as ET
import json
import sys
import os
from datetime import datetime


def parse_nmap_xml(xml_file: str) -> dict:
    """
    解析Nmap XML文件，返回结构化数据

    Args:
        xml_file: Nmap XML输出文件路径

    Returns:
        dict: 包含主机、端口、服务信息的字典
    """
    if not os.path.isfile(xml_file):
        print(f"[ERROR] 文件不存在: {xml_file}", file=sys.stderr)
        return {"hosts": [], "summary": {}}

    try:
        tree = ET.parse(xml_file)
    except ET.ParseError as e:
        print(f"[ERROR] XML解析失败: {e}", file=sys.stderr)
        return {"hosts": [], "summary": {}}

    root = tree.getroot()
    result = {
        "scan_info": {},
        "hosts": [],
        "summary": {
            "total_hosts": 0,
            "hosts_up": 0,
            "hosts_down": 0,
            "total_open_ports": 0,
            "services": {},
        },
    }

    # 扫描信息
    if root.attrib:
        result["scan_info"] = {
            "scanner": root.get("scanner", "nmap"),
            "args": root.get("args", ""),
            "start_time": root.get("startstr", ""),
            "version": root.get("version", ""),
        }

    # 遍历主机
    for host_elem in root.findall("host"):
        host_data = _parse_host(host_elem)
        result["hosts"].append(host_data)

        # 更新统计
        if host_data["status"] == "up":
            result["summary"]["hosts_up"] += 1
            result["summary"]["total_open_ports"] += len(host_data["open_ports"])
            for port_info in host_data["open_ports"]:
                svc = port_info.get("service", "unknown")
                result["summary"]["services"][svc] = (
                    result["summary"]["services"].get(svc, 0) + 1
                )
        else:
            result["summary"]["hosts_down"] += 1

    result["summary"]["total_hosts"] = len(result["hosts"])
    return result


def _parse_host(host_elem) -> dict:
    """解析单个主机元素"""
    host = {
        "ip": "",
        "hostname": "",
        "status": "unknown",
        "os": [],
        "open_ports": [],
        "scripts": [],
    }

    # 状态
    status_elem = host_elem.find("status")
    if status_elem is not None:
        host["status"] = status_elem.get("state", "unknown")

    # IP地址
    for addr in host_elem.findall("address"):
        if addr.get("addrtype") == "ipv4":
            host["ip"] = addr.get("addr", "")
        elif addr.get("addrtype") == "mac":
            host["mac"] = addr.get("addr", "")
            host["mac_vendor"] = addr.get("vendor", "")

    # 主机名
    hostnames = host_elem.find("hostnames")
    if hostnames is not None:
        for hn in hostnames.findall("hostname"):
            host["hostname"] = hn.get("name", "")
            break

    # 端口
    ports_elem = host_elem.find("ports")
    if ports_elem is not None:
        for port_elem in ports_elem.findall("port"):
            port_data = _parse_port(port_elem)
            if port_data and port_data.get("state") == "open":
                host["open_ports"].append(port_data)

    # 操作系统检测
    os_elem = host_elem.find("os")
    if os_elem is not None:
        for osmatch in os_elem.findall("osmatch"):
            host["os"].append(
                {
                    "name": osmatch.get("name", ""),
                    "accuracy": osmatch.get("accuracy", ""),
                }
            )

    # 主机级脚本
    hostscript = host_elem.find("hostscript")
    if hostscript is not None:
        for script in hostscript.findall("script"):
            host["scripts"].append(
                {"id": script.get("id", ""), "output": script.get("output", "")}
            )

    return host


def _parse_port(port_elem) -> dict:
    """解析单个端口元素"""
    port = {
        "port": int(port_elem.get("portid", 0)),
        "protocol": port_elem.get("protocol", "tcp"),
        "state": "",
        "service": "",
        "version": "",
        "product": "",
        "scripts": [],
    }

    state_elem = port_elem.find("state")
    if state_elem is not None:
        port["state"] = state_elem.get("state", "")

    service_elem = port_elem.find("service")
    if service_elem is not None:
        port["service"] = service_elem.get("name", "")
        port["product"] = service_elem.get("product", "")
        port["version"] = service_elem.get("version", "")
        port["extra_info"] = service_elem.get("extrainfo", "")

    for script in port_elem.findall("script"):
        port["scripts"].append(
            {"id": script.get("id", ""), "output": script.get("output", "")}
        )

    return port


def extract_live_hosts(nmap_data: dict) -> list:
    """提取存活主机IP列表"""
    return [h["ip"] for h in nmap_data.get("hosts", []) if h["status"] == "up"]


def extract_web_services(nmap_data: dict) -> list:
    """提取Web服务列表（HTTP/HTTPS端口）"""
    web_services = []
    web_port_names = {"http", "https", "http-proxy", "http-alt", "https-alt"}

    for host in nmap_data.get("hosts", []):
        if host["status"] != "up":
            continue
        for port in host.get("open_ports", []):
            svc = port.get("service", "").lower()
            if svc in web_port_names or port["port"] in (80, 443, 8080, 8443):
                proto = "https" if "ssl" in svc or "https" in svc or port["port"] in (443, 8443) else "http"
                web_services.append(
                    {
                        "url": f"{proto}://{host['ip']}:{port['port']}",
                        "ip": host["ip"],
                        "port": port["port"],
                        "service": svc,
                        "product": port.get("product", ""),
                        "version": port.get("version", ""),
                    }
                )
    return web_services


def extract_db_services(nmap_data: dict) -> list:
    """提取数据库服务列表"""
    db_services = []
    db_port_names = {"mysql", "postgresql", "ms-sql-s", "oracle-tns", "mongodb", "redis", "memcached"}
    db_ports = {3306, 5432, 1433, 1521, 27017, 6379, 11211}

    for host in nmap_data.get("hosts", []):
        if host["status"] != "up":
            continue
        for port in host.get("open_ports", []):
            svc = port.get("service", "").lower()
            if svc in db_port_names or port["port"] in db_ports:
                db_services.append(
                    {
                        "ip": host["ip"],
                        "port": port["port"],
                        "service": svc,
                        "product": port.get("product", ""),
                        "version": port.get("version", ""),
                    }
                )
    return db_services


def to_json(data: dict, output_file: str = None) -> str:
    """输出JSON格式"""
    json_str = json.dumps(data, indent=2, ensure_ascii=False)
    if output_file:
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(json_str)
        print(f"[INFO] 结果已保存: {output_file}", file=sys.stderr)
    return json_str


def main():
    """主入口"""
    if len(sys.argv) < 2:
        print("用法: nmap-parse.py <nmap_xml_file> [output_json]", file=sys.stderr)
        print("  解析Nmap XML输出并转换为JSON格式", file=sys.stderr)
        sys.exit(1)

    xml_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    data = parse_nmap_xml(xml_file)

    if output_file:
        to_json(data, output_file)
    else:
        print(to_json(data))

    # 打印摘要
    summary = data.get("summary", {})
    print(f"\n[摘要]", file=sys.stderr)
    print(f"  总主机数: {summary.get('total_hosts', 0)}", file=sys.stderr)
    print(f"  存活主机: {summary.get('hosts_up', 0)}", file=sys.stderr)
    print(f"  开放端口: {summary.get('total_open_ports', 0)}", file=sys.stderr)
    print(f"  服务分布: {summary.get('services', {})}", file=sys.stderr)


if __name__ == "__main__":
    main()

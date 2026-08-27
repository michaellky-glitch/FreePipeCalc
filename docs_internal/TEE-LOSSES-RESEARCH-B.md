# Hydraulic Tee Loss Models and Technical Specification

## 1. Overview
This document explains how hydraulic simulation software calculates pressure losses in pipe tees. It compares static industry methods with dynamic engineering approaches using ASD-STE100 principles.

## 2. Problem Statement
Many hydraulic calculation engines use fixed values for tee fitting losses. They use static equivalent length ratio ($L/D$) or constant loss coefficients ($K$).

Static methods have these limitations:
- They assume a fixed ratio of flow split.
- They do not change when the flow ratio ($Q_b/Q_c$) changes.
- They cause calculation errors during dynamic flow simulations.

For example, a five percent branch flow split creates a different loss coefficient than a ninety percent flow split. Constant values cannot calculate this physical difference.

## 3. Industry Standards for Tee Loss Models

### 3.1 Crane TP-410 and Carrier Handbook
- Uses fixed equivalent length ($L/D$) or static $K$-factors.
- Determines loss values from pipe diameter and fitting geometry.
- Provides correct values at the main design point.
- Causes errors when flow moves away from the design point.

### 3.2 Idelchik Handbook of Hydraulic Resistance
- Acts as the primary standard for dynamic loss calculations.
- Defines loss coefficients as continuous equations.
- Uses both area ratio ($A_b/A_c$) and flow ratio ($Q_b/Q_c$).
- Covers dividing flow cases and combining flow cases.

### 3.3 Miller Internal Flow Systems
- Uses experimental test data for pipe junctions.
- Includes negative loss coefficients for combining flows.
- Shows energy transfer from the main stream to the branch stream.

### 3.4 ASHRAE Fundamentals (Chapter 22)
- Uses tables and charts based on physical test data.
- Maps branch loss coefficients ($K$) against the flow ratio ($Q_b/Q_c$).
- Gives precise curves for branch fittings.

## 4. Reference Velocity Conversion

### 4.1 Velocity Mismatch Problem
- Published datasets reference the common pipe velocity ($V_c$).
- Network solvers require resistance based on local pipe velocity ($V_b$).
- You must convert the published coefficient to the local branch pipe.

### 4.2 Mathematical Formula
To keep the calculated pressure drop equal, scale the published coefficient:

$$K_{\text{local}} = K_{\text{published}} \cdot \left( \frac{A_b}{A_c} \cdot \frac{Q_c}{Q_b} \right)^2$$

Where:
- $K_{\text{local}}$ is the loss coefficient for the branch pipe.
- $K_{\text{published}}$ is the published coefficient from the standard.
- $A_b$ is the cross-sectional area of the branch pipe.
- $A_c$ is the cross-sectional area of the common pipe.
- $Q_b$ is the volumetric flow rate in the branch pipe.
- $Q_c$ is the volumetric flow rate in the common pipe.

## 5. Implementation Strategy for Hydraulic Solvers

### 5.1 Two-Pass Freeze Procedure
To prevent loop convergence failure, use this procedure:
1. Complete the initial solver pass to find pipe flow rates.
2. Calculate the flow ratio ($Q_b/Q_c$) at each tee fitting.
3. Update the local loss coefficient ($K_{\text{local}}$) for the branch leg.
4. Freeze the value of $K_{\text{local}}$ during the matrix solver step.
5. Re-derive fitting values between main solver iterations.

### 5.2 Industry Method Comparison

| Standard / Method | Required Inputs | Dynamic Accuracy | Implementation Effort |
| :--- | :--- | :--- | :--- |
| **Crane TP-410 / Carrier** | Fitting type, Diameter | Low | Very Low |
| **ASHRAE Branch Only** | Flow ratio ($Q_b/Q_c$) | Medium-High | Medium |
| **Idelchik / Miller Full** | Flow ratio ($Q_b/Q_c$), Area ratio ($A_b/A_c$) | High | High |
